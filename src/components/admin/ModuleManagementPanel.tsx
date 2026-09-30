import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Trash2, Plus, Loader2, ShieldCheck, Package } from "lucide-react";
import { toast } from "sonner";

interface ModuleConfig {
  id: string;
  label: string;
  enabled: boolean;
  tier: string;
  updated_at: string;
}

interface ModuleGrant {
  id: string;
  user_id: string;
  module_id: string;
  granted_by: string;
  expires_at: string | null;
  created_at: string;
  email?: string;
}

const TIER_OPTIONS = [
  { value: "free", label: "Free" },
  { value: "pro", label: "Pro" },
  { value: "token", label: "Token" },
  { value: "disabled", label: "Disabled" },
];

export default function ModuleManagementPanel() {
  const { user } = useAuth();
  const [configs, setConfigs] = useState<ModuleConfig[]>([]);
  const [grants, setGrants] = useState<ModuleGrant[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);

  // Grant form
  const [grantEmail, setGrantEmail] = useState("");
  const [grantModule, setGrantModule] = useState("");
  const [grantExpiry, setGrantExpiry] = useState("");
  const [granting, setGranting] = useState(false);

  const fetchData = async () => {
    setLoading(true);
    const [configRes, grantRes] = await Promise.all([
      supabase.from("module_configs").select("*").order("id"),
      supabase.from("user_module_grants").select("*").order("created_at", { ascending: false }),
    ]);
    if (configRes.data) setConfigs(configRes.data);
    if (grantRes.data) {
      // Enrich grants with profile display names
      const userIds = [...new Set(grantRes.data.map((g) => g.user_id))];
      const { data: profiles } = await supabase
        .from("profiles")
        .select("user_id, display_name")
        .in("user_id", userIds);
      const profileMap = new Map(profiles?.map((p) => [p.user_id, p.display_name]) ?? []);
      setGrants(
        grantRes.data.map((g) => ({ ...g, email: profileMap.get(g.user_id) || g.user_id.slice(0, 8) }))
      );
    }
    setLoading(false);
  };

  useEffect(() => { fetchData(); }, []);

  const updateConfig = async (id: string, updates: Partial<ModuleConfig>) => {
    setSaving(id);
    const { error } = await supabase
      .from("module_configs")
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq("id", id);
    if (error) toast.error(error.message);
    else {
      setConfigs((prev) => prev.map((c) => (c.id === id ? { ...c, ...updates } : c)));
      toast.success(`Module "${id}" updated`);
    }
    setSaving(null);
  };

  const handleGrant = async () => {
    if (!grantEmail || !grantModule || !user) return;
    setGranting(true);
    // Look up user by display_name or pen_name
    const { data: profiles } = await supabase
      .from("profiles")
      .select("user_id, display_name")
      .or(`display_name.ilike.%${grantEmail}%,pen_name.ilike.%${grantEmail}%`)
      .limit(1);

    if (!profiles?.length) {
      toast.error("No user found matching that name/email");
      setGranting(false);
      return;
    }

    const targetUserId = profiles[0].user_id;
    const { error } = await supabase.from("user_module_grants").upsert(
      {
        user_id: targetUserId,
        module_id: grantModule,
        granted_by: user.id,
        expires_at: grantExpiry || null,
      },
      { onConflict: "user_id,module_id" }
    );

    if (error) toast.error(error.message);
    else {
      toast.success(`Granted "${grantModule}" to ${profiles[0].display_name || targetUserId.slice(0, 8)}`);
      setGrantEmail("");
      setGrantModule("");
      setGrantExpiry("");
      fetchData();
    }
    setGranting(false);
  };

  const revokeGrant = async (id: string) => {
    const { error } = await supabase.from("user_module_grants").delete().eq("id", id);
    if (error) toast.error(error.message);
    else {
      setGrants((prev) => prev.filter((g) => g.id !== id));
      toast.success("Grant revoked");
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Module Configs */}
      <div className="rounded-xl border border-border/50 bg-card/80 p-6">
        <div className="flex items-center gap-2 mb-4">
          <Package className="h-4 w-4 text-primary" />
          <h3 className="font-body text-sm font-semibold">Pinnable Module Configs</h3>
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="text-xs font-mono">Module</TableHead>
              <TableHead className="text-xs font-mono">Enabled</TableHead>
              <TableHead className="text-xs font-mono">Tier</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {configs.map((c) => (
              <TableRow key={c.id}>
                <TableCell className="text-xs font-mono">{c.label}</TableCell>
                <TableCell>
                  <Switch
                    checked={c.enabled}
                    onCheckedChange={(val) => updateConfig(c.id, { enabled: val })}
                    disabled={saving === c.id}
                  />
                </TableCell>
                <TableCell>
                  <Select
                    value={c.tier}
                    onValueChange={(val) => updateConfig(c.id, { tier: val })}
                    disabled={saving === c.id}
                  >
                    <SelectTrigger className="h-7 w-[100px] text-xs font-mono">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {TIER_OPTIONS.map((t) => (
                        <SelectItem key={t.value} value={t.value} className="text-xs font-mono">
                          {t.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* User Module Grants */}
      <div className="rounded-xl border border-border/50 bg-card/80 p-6">
        <div className="flex items-center gap-2 mb-4">
          <ShieldCheck className="h-4 w-4 text-primary" />
          <h3 className="font-body text-sm font-semibold">Per-User Module Grants</h3>
        </div>

        {/* Grant form */}
        <div className="flex flex-wrap items-end gap-2 mb-4 p-3 rounded-lg bg-muted/20 border border-border/30">
          <div className="space-y-1">
            <label className="text-[10px] font-mono text-muted-foreground uppercase">User (name)</label>
            <Input
              value={grantEmail}
              onChange={(e) => setGrantEmail(e.target.value)}
              placeholder="Display name..."
              className="h-8 w-[180px] text-xs"
            />
          </div>
          <div className="space-y-1">
            <label className="text-[10px] font-mono text-muted-foreground uppercase">Module</label>
            <Select value={grantModule} onValueChange={setGrantModule}>
              <SelectTrigger className="h-8 w-[150px] text-xs font-mono">
                <SelectValue placeholder="Select..." />
              </SelectTrigger>
              <SelectContent>
                {configs.map((c) => (
                  <SelectItem key={c.id} value={c.id} className="text-xs font-mono">
                    {c.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <label className="text-[10px] font-mono text-muted-foreground uppercase">Expires (optional)</label>
            <Input
              type="date"
              value={grantExpiry}
              onChange={(e) => setGrantExpiry(e.target.value)}
              className="h-8 w-[140px] text-xs"
            />
          </div>
          <Button size="sm" className="h-8 text-xs gap-1" onClick={handleGrant} disabled={granting || !grantEmail || !grantModule}>
            {granting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
            Grant
          </Button>
        </div>

        {/* Grants list */}
        {grants.length > 0 ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-xs font-mono">User</TableHead>
                <TableHead className="text-xs font-mono">Module</TableHead>
                <TableHead className="text-xs font-mono">Expires</TableHead>
                <TableHead className="text-xs font-mono w-[60px]" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {grants.map((g) => (
                <TableRow key={g.id}>
                  <TableCell className="text-xs font-mono">{g.email}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className="text-[10px] font-mono">{g.module_id}</Badge>
                  </TableCell>
                  <TableCell className="text-xs font-mono text-muted-foreground">
                    {g.expires_at ? new Date(g.expires_at).toLocaleDateString() : "Never"}
                  </TableCell>
                  <TableCell>
                    <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => revokeGrant(g.id)}>
                      <Trash2 className="h-3 w-3 text-destructive" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <p className="text-xs text-muted-foreground text-center py-4">No per-user module grants yet</p>
        )}
      </div>
    </div>
  );
}
