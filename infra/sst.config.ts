/**
 * SST v3 infrastructure (KICKOFF: infra/ SST stacks).
 *
 * Week-1 placeholder. The deploy target (PRD §: VPC us-east-1 multi-AZ, ALB with
 * WSS upgrade, NAT, CloudFront/Route53/WAF, ECS Fargate task families) firms up
 * before this is fleshed out. To start: `pnpm dlx sst@latest init`, which
 * generates `.sst/platform/config.d.ts`, then define the stacks here.
 */
export const infra = {
  app: 'allyvate-brain',
  region: 'us-east-1',
} as const;
