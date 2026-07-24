import MicrophoneClient from "./microphone-client";
import type { SpeakerRole } from "../../session/remote-microphone-service";

type PageProps = {
  params: Promise<{
    role: string;
  }>;
};

export default async function MicrophonePage(props: PageProps) {
  const { role } = await props.params;
  const normalizedRole: SpeakerRole =
    role === "caregiver" || role === "elder" ? role : "elder";
  const valid = role === "caregiver" || role === "elder";

  return <MicrophoneClient role={normalizedRole} validRole={valid} />;
}
