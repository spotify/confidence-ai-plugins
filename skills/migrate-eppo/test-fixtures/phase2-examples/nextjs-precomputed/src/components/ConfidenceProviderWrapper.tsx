import { ConfidenceProvider } from '@spotify-confidence/openfeature-server-provider-local/react-server';
import { getEvaluationContext } from '@/lib/getEvaluationContext';
import '@/lib/confidence';

export const ConfidenceProviderWrapper = async ({ children }: React.PropsWithChildren) => {
  const context = await getEvaluationContext();

  return <ConfidenceProvider context={context}>{children}</ConfidenceProvider>;
};
