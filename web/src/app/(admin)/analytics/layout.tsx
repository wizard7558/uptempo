import { ReportsTabs } from "./reports-tabs";

export default function ReportsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <ReportsTabs />
      {children}
    </>
  );
}
