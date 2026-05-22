import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isSupabaseConfigured } from "@/lib/env";
import { SetupNotice } from "@/components/SetupNotice";
import { AppHeader } from "@/components/AppHeader";
import type { Role } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  if (!isSupabaseConfigured()) return <SetupNotice />;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("email, role")
    .eq("id", user.id)
    .single();

  return (
    <div className="min-h-screen">
      <AppHeader
        email={profile?.email ?? user.email ?? ""}
        role={(profile?.role as Role) ?? "user"}
      />
      <main className="max-w-5xl mx-auto px-6 py-8">{children}</main>
    </div>
  );
}
