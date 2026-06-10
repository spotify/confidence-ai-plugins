'use server';

import type { EvaluationContext } from '@openfeature/server-sdk';

export const getEvaluationContext = async (): Promise<EvaluationContext> => {
  const targetingKey = `test-user-${Math.random().toString(36).substring(2, 10)}`;
  return { targetingKey };
};
