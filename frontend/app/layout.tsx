import "./globals.css";
import type { Metadata } from "next";
import Navbar from "../components/Navbar";
import Footer from "../components/Footer";

const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL || "https://www.plantasa.com.br").replace(/\/$/, "");
const siteName = "Plantasã";
const siteTitle = "Plantasã | Consultoria agrícola com IA";
const siteDescription =
  "Consultoria agrícola com inteligência artificial, revisão humana especializada e orientação para produção orgânica, manejo de culturas, pragas e doenças.";
const previewImageUrl = `${siteUrl}/images/plantasa-og-preview.png`;

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: siteTitle,
    template: `%s | ${siteName}`,
  },
  description: siteDescription,
  alternates: {
    canonical: "/",
  },
  openGraph: {
    title: siteTitle,
    description: siteDescription,
    url: "/",
    siteName,
    locale: "pt_BR",
    type: "website",
    images: [
      {
        url: previewImageUrl,
        width: 1200,
        height: 630,
        alt: "Logo da Plantasã com informações da consultoria agrícola com IA.",
        type: "image/png",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: siteTitle,
    description: siteDescription,
    images: [previewImageUrl],
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>
        <Navbar />
        <main className="min-h-screen">{children}</main>
        <Footer />
      </body>
    </html>
  );
}
