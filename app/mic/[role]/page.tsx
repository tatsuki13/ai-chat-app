import RemoteMicClientShell from "../remote-mic-client-shell";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type RemoteMicRole = "elder" | "caregiver";

type PageProps = {
  params: Promise<{
    role?: string;
  }>;
};

export default async function FixedRemoteMicPage(props: PageProps) {
  const params = await props.params;
  const role = parseRemoteMicRole(params.role);

  return <RemoteMicClientShell role={role} />;
}

function parseRemoteMicRole(value: unknown): RemoteMicRole | null {
  return value === "elder" || value === "caregiver" ? value : null;
}
