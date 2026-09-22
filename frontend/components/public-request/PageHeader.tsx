import Link from "next/link";
import SectionTitle from "../SectionTitle";

type Props = {
  eyebrow: string;
  title: string;
  subtitle: string;
  backLink?: { href: string; label: string };
};

/** Cabecalho comum das paginas de Contato e Solicitacao de Orcamento. */
export default function PageHeader({ eyebrow, title, subtitle, backLink }: Props) {
  return (
    <>
      {backLink ? (
        <Link href={backLink.href} className="text-sm font-semibold text-leaf-700">
          ← {backLink.label}
        </Link>
      ) : null}
      <div className={backLink ? "mt-4" : ""}>
        <p className="mb-3 inline-flex max-w-full rounded-full bg-leaf-50 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-leaf-700">
          {eyebrow}
        </p>
        <SectionTitle title={title} subtitle={subtitle} />
      </div>
    </>
  );
}
