import "@/components/ui/styles.css";
import { AuthBridgeBootstrap } from "@/components/AuthBridgeBootstrap";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif" }}>
        <AuthBridgeBootstrap />
        {children}
      </body>
    </html>
  );
}
