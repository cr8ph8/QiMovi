// Notifies the owner of a shared brief that a new comment was posted.
// - Inserts an in-app notification into user_notifications
// - Triggers an email via send-transactional-email
// Called by the public BriefComments UI right after a comment is successfully posted.
// Skips silently if the commenter is the owner.

import { createClient } from 'npm:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
}

const BRIEF_COMMENT_NOTIFICATIONS_ON_HOLD = true

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!supabaseUrl || !serviceKey) {
    return json(500, { error: 'Server configuration error' })
  }

  let commentId: string | undefined
  let shareToken: string | undefined
  try {
    const body = await req.json()
    commentId = typeof body.commentId === 'string' ? body.commentId : undefined
    shareToken = typeof body.shareToken === 'string' ? body.shareToken : undefined
  } catch {
    return json(400, { error: 'Invalid JSON' })
  }

  if (!commentId || !shareToken) {
    return json(400, { error: 'commentId and shareToken are required' })
  }

  const supabase = createClient(supabaseUrl, serviceKey)

  // Fetch comment + verify it belongs to a brief that matches the share token
  const { data: comment, error: cErr } = await supabase
    .from('brief_comments')
    .select('id, brief_id, parent_comment_id, author_user_id, author_name, body, hidden')
    .eq('id', commentId)
    .maybeSingle()

  if (cErr || !comment) {
    return json(404, { error: 'Comment not found' })
  }
  if (comment.hidden) {
    return json(200, { skipped: 'hidden' })
  }

  const { data: brief, error: bErr } = await supabase
    .from('project_briefs')
    .select('id, user_id, title, share_token, visibility')
    .eq('id', comment.brief_id)
    .maybeSingle()

  if (bErr || !brief) {
    return json(404, { error: 'Brief not found' })
  }
  if (brief.share_token !== shareToken) {
    return json(403, { error: 'Token mismatch' })
  }
  if (!['unlisted', 'public'].includes(brief.visibility)) {
    return json(200, { skipped: 'not_shared' })
  }

  // Don't notify the owner about their own comment
  if (comment.author_user_id && comment.author_user_id === brief.user_id) {
    return json(200, { skipped: 'self_comment' })
  }

  if (BRIEF_COMMENT_NOTIFICATIONS_ON_HOLD) {
    return json(503, {
      error: 'security_maintenance',
      message: 'Comment notifications are temporarily paused during a security upgrade.',
    })
  }

  // Lookup owner profile (email + display name)
  const { data: profile } = await supabase
    .from('profiles')
    .select('email, display_name, pen_name')
    .eq('user_id', brief.user_id)
    .maybeSingle()

  const isReply = !!comment.parent_comment_id
  const briefTitle = brief.title || 'Untitled Brain Dump'
  const authorName = comment.author_name || 'Someone'
  const preview = (comment.body || '').slice(0, 280)
  const shareUrl = `https://caniscreenwrite.com/brief/${shareToken}`

  // 1) In-app notification (best effort)
  const { error: nErr } = await supabase.from('user_notifications').insert({
    user_id: brief.user_id,
    type: 'info',
    title: isReply ? `New reply on "${briefTitle}"` : `New comment on "${briefTitle}"`,
    message: `${authorName}: ${preview}`,
    metadata: {
      kind: 'brief_comment',
      brief_id: brief.id,
      comment_id: comment.id,
      parent_comment_id: comment.parent_comment_id,
      share_token: shareToken,
      share_url: shareUrl,
      author_name: authorName,
      is_reply: isReply,
    },
  })
  if (nErr) {
    console.error('user_notifications insert failed', nErr)
  }

  // 2) Email notification (best effort)
  let emailStatus: string = 'skipped_no_email'
  if (profile?.email) {
    const ownerName = profile.display_name || profile.pen_name || undefined
    const { error: eErr } = await supabase.functions.invoke('send-transactional-email', {
      body: {
        templateName: 'brief-comment-notification',
        recipientEmail: profile.email,
        idempotencyKey: `brief-comment-${comment.id}`,
        templateData: {
          briefTitle,
          authorName,
          commentBody: preview,
          isReply,
          shareUrl,
          ownerName,
        },
      },
    })
    emailStatus = eErr ? `error:${eErr.message}` : 'queued'
    if (eErr) console.error('send-transactional-email failed', eErr)
  }

  return json(200, { ok: true, notified: brief.user_id, email: emailStatus })
})
