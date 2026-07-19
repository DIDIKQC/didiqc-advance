import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "didiQCsys v9.12 (Next.js Port)",
  description: "Sistem Manajemen Quality Control Laboratorium — ported from Google Apps Script to Next.js",
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
