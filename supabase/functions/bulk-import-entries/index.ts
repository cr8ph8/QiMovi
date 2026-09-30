import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { createClient } from 'npm:@supabase/supabase-js@2';
import { z } from 'npm:zod@3.23.8';
import { logGovernanceAction } from "../_shared/audit.ts";

const RowSchema = z.object({
  title: z.string().trim().min(1).max(300),
  writer_name: z.string().trim().min(1).max(200),
  writer_email: z.string().trim().email().max(255),
  logline: z.string().trim().max(1000).optional().nullable(),
  genre: z.string().trim().max(120).optional().nullable(),
  page_count: z.number().int().min(1).max(500),
  script_url: z.string().trim().url().refine((u) => u.startsWith('https://'), 'must be https'),
  format: z.enum(['pdf', 'fountain', 'fdx']).optional().nullable(),
  notes: z.string().trim().max(2000).optional().nullable(),
});

const BodySchema = z.object({
  competition_id: z.string().uuid(),
  rows: z.array(z.unknown()).min(1).max(500),
});

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return json({ error: 'unauthorized' }, 401);
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userRes, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userRes.user) return json({ error: 'unauthorized' }, 401);
    const userId = userRes.user.id;

    const body = await req.json().catch(() => null);
    const parsed = BodySchema.safeParse(body);
    if (!parsed.success) {
      return json({ error: 'invalid_body', details: parsed.error.flatten() }, 400);
    }
    const { competition_id, rows } = parsed.data;

    const admin = createClient(supabaseUrl, serviceKey);

    // Authorize: admin OR lead judge of competition
    const [{ data: isAdminData }, { data: leadRow }] = await Promise.all([
      admin.rpc('has_role', { _user_id: userId, _role: 'admin' }),
      admin.from('competition_judges')
        .select('id')
        .eq('competition_id', competition_id)
        .eq('user_id', userId)
        .eq('role', 'lead')
        .maybeSingle(),
    ]);
    const isAdmin = !!isAdminData;
    const isLead = !!leadRow;
    if (!isAdmin && !isLead) return json({ error: 'forbidden' }, 403);

    // Competition exists + page bounds
    const { data: comp } = await admin
      .from('competitions')
      .select('id,judging_tier')
      .eq('id', competition_id)
      .maybeSingle();
    if (!comp) return json({ error: 'competition_not_found' }, 404);

    // Existing entries (dedupe by writer_email + lower(title))
    const { data: existing } = await admin
      .from('entries')
      .select('title,writer_email')
      .eq('competition_id', competition_id);
    const existingKeys = new Set(
      (existing ?? [])
        .filter((e: any) => e.writer_email)
        .map((e: any) => `${(e.writer_email as string).toLowerCase()}::${(e.title as string).toLowerCase()}`),
    );

    const batchId = crypto.randomUUID();
    const errors: { row: number; error: string }[] = [];
    const validated: any[] = [];
    const seenInBatch = new Set<string>();

    rows.forEach((raw, idx) => {
      const r = RowSchema.safeParse(raw);
      if (!r.success) {
        errors.push({ row: idx + 1, error: r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') });
        return;
      }
      const key = `${r.data.writer_email.toLowerCase()}::${r.data.title.toLowerCase()}`;
      if (seenInBatch.has(key)) {
        errors.push({ row: idx + 1, error: 'duplicate within file' });
        return;
      }
      if (existingKeys.has(key)) {
        errors.push({ row: idx + 1, error: 'duplicate of existing entry' });
        return;
      }
      seenInBatch.add(key);
      validated.push({
        user_id: userId,
        competition_id,
        title: r.data.title,
        logline: r.data.logline ?? null,
        genre: r.data.genre ?? null,
        page_count: r.data.page_count,
        author: r.data.writer_name,
        writer_name: r.data.writer_name,
        writer_email: r.data.writer_email.toLowerCase(),
        external_script_url: r.data.script_url,
        bulk_notes: r.data.notes ?? null,
        source: 'bulk_import',
        status: 'submitted',
        method_type: 'human',
        imported_by: userId,
        import_batch_id: batchId,
      });
    });

    let imported = 0;
    if (validated.length > 0) {
      const { data: ins, error: insErr } = await admin
        .from('entries')
        .insert(validated)
        .select('id');
      if (insErr) return json({ error: 'insert_failed', detail: insErr.message }, 500);
      imported = ins?.length ?? 0;
    }

    await logGovernanceAction({
      action: 'bulk_import_entries',
      userId: userId,
      details: {
        batch_id: batchId,
        competition_id,
        imported,
        skipped: errors.length,
        errors: errors.slice(0, 50),
      },
    });

    return json({ batch_id: batchId, imported, skipped: errors.length, errors });
  } catch (e) {
    return json({ error: 'unexpected', detail: (e as Error).message }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
