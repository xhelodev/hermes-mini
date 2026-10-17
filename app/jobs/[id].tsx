import { useLocalSearchParams } from 'expo-router';

import { JobEditor } from '@/components/job-editor';
import { BotScope } from '@/contexts/bots-context';
import { RequireConnection } from '@/contexts/connection-context';

function oneParam(value: string | string[] | undefined): string {
  return Array.isArray(value) ? (value[0] ?? '') : (value ?? '');
}

export default function JobScreen() {
  const params = useLocalSearchParams<{ id: string; bot?: string }>();
  const id = oneParam(params.id);

  return (
    <RequireConnection>
      <BotScope bot={oneParam(params.bot)}>
        <JobEditor jobId={id} />
      </BotScope>
    </RequireConnection>
  );
}
