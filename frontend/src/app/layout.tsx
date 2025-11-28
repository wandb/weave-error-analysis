import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Error Analysis | Weave",
  description: "Bottom-up error analysis for AI systems",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased bg-grid-pattern min-h-screen">
        {children}
      </body>
    </html>
  );
}

