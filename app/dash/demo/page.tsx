import type { Metadata } from "next";
import { SiteHeader } from "@/components/SiteChrome";
import { Dashboard } from "@/components/dash/Dashboard";

export const metadata: Metadata = {
  title: "Demo dashboard",
  robots: { index: false, follow: false },
};

// Read-only seller dashboard of the demo shop, open to anyone (judges can watch their own test order land).
export default function DemoDashPage() {
  return (
    <>
      <SiteHeader current="dash" />
      <main>
        <Dashboard demo />
      </main>
    </>
  );
}
