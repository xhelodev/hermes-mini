import { useLocalSearchParams } from 'expo-router';

import { JobEditor } from '@/components/job-editor';
import { RequireConnection } from '@/contexts/connection-context';

function oneParam(value: string | string[] | undefined): string {
  return Array.isArray(value) ? (value[0] ?? '') : (value ?? '');
}

export default function JobScreen() {
  const params = useLocalSearchParams<{ id: string }>();
  const id = oneParam(params.id);

  return (
    <RequireConnection>
      <JobEditor jobId={id} />
    </RequireConnection>
  );
}
