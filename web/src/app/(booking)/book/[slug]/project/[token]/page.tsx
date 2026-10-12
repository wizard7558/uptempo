import { notFound } from "next/navigation";
import { getProjectForClient } from "@/actions/projects";
import { ProjectClient } from "./project-client";

export const metadata = { title: "Your design", robots: { index: false, follow: false } };

export default async function ProjectDesignPage({
  params,
}: {
  params: Promise<{ slug: string; token: string }>;
}) {
  const { slug, token } = await params;
  const data = await getProjectForClient(slug, token);
  if (!data) notFound();
  return <ProjectClient slug={slug} token={token} data={data} />;
}
