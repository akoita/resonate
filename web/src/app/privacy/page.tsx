import type { Metadata } from "next";
import { LegalPage } from "../../components/legal/LegalPage";
import { renderLegalMarkdown } from "../../lib/legalDocuments";
export const metadata: Metadata = { title: "Privacy Policy" };
export default function Page() { return <LegalPage markdown={renderLegalMarkdown("privacy")} />; }
