import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Error analysis | Weave",
  description: "Bottom-up error analysis for AI systems",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased min-h-screen bg-moon-900">
        {children}
      </body>
    </html>
  );
}

