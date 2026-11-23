import Providers from "@/components/Providers";
import Shell from "@/components/Shell";

export default function TerminalLayout({ children }: { children: React.ReactNode }) {
  return (
    <Providers>
      <Shell>{children}</Shell>
    </Providers>
  );
}
