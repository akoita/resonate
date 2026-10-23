import { Suspense } from "react";
import DisputeDashboard from "@/components/disputes/DisputeDashboard";

export const metadata = {
  title: "Disputes",
  description: "View and manage content disputes on Resonate",
};

export default function DisputesPage() {
  // DisputeDashboard reads useSearchParams(); keep its Suspense boundary local so
  // the rest of the shell is not deferred behind it (#2290).
  return (
    <Suspense fallback={null}>
      <DisputeDashboard />
    </Suspense>
  );
}
