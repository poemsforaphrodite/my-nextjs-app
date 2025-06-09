import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Python Documentation Generator",
  description: "Generate comprehensive documentation for Python files using AI",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">
        {children}
      </body>
    </html>
  );
}
