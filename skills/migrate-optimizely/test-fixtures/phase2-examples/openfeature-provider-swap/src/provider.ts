/**
 * A hand-written OpenFeature provider wrapping the Optimizely SDK
 * (a common pattern: a custom provider behind the OpenFeature global
 * API). This is the ONLY file the provider-swap
 * migration touches: replace this class + its registration with the
 * Confidence OpenFeature provider. The call sites in App.tsx (useFlag)
 * do NOT change.
 *
 * Note the business semantics encoded here (on/off-string modelling +
 * anonymous suppression). On migration these must be re-homed on top of
 * the Confidence provider, not silently dropped — see the skill's
 * "Already on OpenFeature → provider swap".
 */
import type {
  Provider,
  ResolutionDetails,
  EvaluationContext,
} from '@openfeature/web-sdk';
import { createInstance, type Client } from '@optimizely/optimizely-sdk';

const ON_OFF_STRING_FLAGS = new Set(['analytics', 'nike_classification', 'new_ui']);

export class OptimizelyProvider implements Provider {
  readonly runsOn = 'client';
  readonly metadata = { name: 'Optimizely Provider' } as const;

  private client: Client;
  private ready = false;

  constructor(sdkKey: string) {
    this.client = createInstance({
      sdkKey,
      datafileOptions: { autoUpdate: true, updateInterval: 300000 },
    });
    this.client.onReady().then(() => {
      this.ready = true;
    });
  }

  private attrs(context: EvaluationContext): Record<string, unknown> {
    const { targetingKey, ...rest } = context;
    return rest;
  }

  resolveBooleanEvaluation(
    flagKey: string,
    defaultValue: boolean,
    context: EvaluationContext
  ): ResolutionDetails<boolean> {
    if (!this.ready) return { value: defaultValue, reason: 'ERROR', errorCode: 'PROVIDER_NOT_READY' as never };
    if (context.targetingKey === 'anonymous') return { value: defaultValue, reason: 'DEFAULT' };
    const enabled = this.client.isFeatureEnabled(flagKey, String(context.targetingKey), this.attrs(context));
    return { value: enabled, reason: 'TARGETING_MATCH' };
  }

  resolveStringEvaluation(
    flagKey: string,
    defaultValue: string,
    context: EvaluationContext
  ): ResolutionDetails<string> {
    if (!this.ready) return { value: defaultValue, reason: 'ERROR', errorCode: 'PROVIDER_NOT_READY' as never };
    // on/off-string modelling: these flags resolve to 'on'/'off' from isFeatureEnabled.
    if (ON_OFF_STRING_FLAGS.has(flagKey)) {
      const enabled = this.client.isFeatureEnabled(flagKey, String(context.targetingKey), this.attrs(context));
      return { value: enabled ? 'on' : 'off', reason: 'TARGETING_MATCH' };
    }
    const value = this.client.getFeatureVariableString(flagKey, 'value', String(context.targetingKey), this.attrs(context));
    return { value: value ?? defaultValue, reason: 'TARGETING_MATCH' };
  }

  resolveNumberEvaluation(): ResolutionDetails<number> {
    throw new Error('not used in this fixture');
  }

  resolveObjectEvaluation<T extends object>(): ResolutionDetails<T> {
    throw new Error('not used in this fixture');
  }
}
