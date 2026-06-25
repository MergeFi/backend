import PolicyDetailClient from './policy-detail-client';

export function generateStaticParams() {
  return [];
}

export default async function PolicyDetailPage({ params }: { params: Promise<{ id: string }> }) {
  return <PolicyDetailClient params={params} />;
}
