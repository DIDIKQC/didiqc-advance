import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "didiQCsys v9",
  description: "Sistem Manajemen Quality Control Laboratorium — didik-digital Quality Control System",
  applicationName: "didiQCsys v9",
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "any" },
      { url: "/favicon-32.png", type: "image/png", sizes: "32x32" },
      { url: "/favicon-16.png", type: "image/png", sizes: "16x16" },
    ],
    shortcut: "/favicon.ico",
    apple: "/apple-touch-icon.png",
  },
  appleWebApp: {
    title: "didiQCsys v9",
    statusBarStyle: "black-translucent",
    capable: true,
  },
  manifest: undefined,
};

export const viewport: Viewport = {
  themeColor: "#0f172a",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="id" suppressHydrationWarning>
      <body className="antialiased" style={{ margin: 0, padding: 0, overflow: "hidden" }}>
        {children}
      </body>
    </html>
  );
}
