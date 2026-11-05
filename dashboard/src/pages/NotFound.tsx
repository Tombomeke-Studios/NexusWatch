import { Link } from 'react-router-dom';
import { PageHeader } from '@/components/ui/primitives';
import { routes } from '@/routes';

export function NotFoundPage() {
  return (
    <>
      <PageHeader title="Page not found" subtitle="This page does not exist (yet)." />
      <div>
        <Link className="btn" to={routes.overview}>
          Back to overview
        </Link>
      </div>
    </>
  );
}
