import { JobEditor } from '@/components/job-editor';
import { RequireConnection } from '@/contexts/connection-context';

export default function NuevaJobScreen() {
  return (
    <RequireConnection>
      <JobEditor />
    </RequireConnection>
  );
}
