import AdminDisputeQueue from "@/components/disputes/AdminDisputeQueue";

export const metadata = {
  title: "Admin Review",
  description: "Review and resolve pending content disputes",
};

export default function AdminPage() {
  return <AdminDisputeQueue />;
}
