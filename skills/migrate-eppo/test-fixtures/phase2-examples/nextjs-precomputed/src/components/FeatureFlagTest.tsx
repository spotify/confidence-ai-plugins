'use client';

import { useFlag } from '@spotify-confidence/openfeature-server-provider-local/react-client';

export const FeatureFlagTest = () => {
  const flagKey = process.env.NEXT_PUBLIC_EPPO_FLAG_KEY;
  const flagValue = useFlag(`${flagKey}.enabled`, false);

  return (
    <div className="p-4 border rounded-lg">
      <h2 className="text-lg font-semibold mb-2">Feature Flag Test</h2>
      <div className="space-y-2">
        <div>
          <label className="block text-sm font-medium">Flag Value:</label>
          <span className="text-lg font-mono">{flagValue.toString()}</span>
        </div>
      </div>
    </div>
  );
};
