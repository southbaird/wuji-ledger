export type LedgerOnboardingTarget = 'add-item' | 'add-accessory' | 'view-mode';

export interface LedgerOnboardingStep {
  id: LedgerOnboardingTarget;
  icon: string;
  title: string;
  description: string;
}

export const LEDGER_ONBOARDING_STEPS: readonly LedgerOnboardingStep[] = [
  {
    id: 'add-item',
    icon: 'barcode',
    title: '先记录第一件物品',
    description: '填写名称、买入价格和购买日期；粘贴图片链接后，会自动在本机制作贴纸。',
  },
  {
    id: 'add-accessory',
    icon: 'wrench',
    title: '再补充它的配件',
    description: '配件可以关联到主物品；没有单独填写日期时，会自动沿用主物品的购买日期。',
  },
  {
    id: 'view-mode',
    icon: 'layout-grid',
    title: '用两种方式查看和维护',
    description: '“画廊”适合浏览；“自用编辑”可以直接修改整行，配件会缩进显示在主物品下面。',
  },
];

export function shouldShowLedgerOnboarding(
  recordCount: number,
  onboardingCompleted: boolean,
): boolean {
  return recordCount === 0 && !onboardingCompleted;
}
