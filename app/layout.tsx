import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Volleyball Scoreboard",
  description: "Live volleyball match scoreboard",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="h-full">
      <body className="min-h-full antialiased">{children}</body>
    </html>
  );
}
