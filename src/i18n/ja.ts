import type { TranslationStrings } from '../core/types.js';

export const ja: TranslationStrings = {
  banner: {
    title: 'プライバシーを尊重します',
    description:
      'より良い体験を提供するためにCookieを使用しています。受け入れるカテゴリーを選択できます。',
    acceptAll: 'すべて許可',
    rejectAll: 'すべて拒否',
    settings: '設定',
    privacyPolicy: 'プライバシーポリシー',
    doNotSell: '個人情報を販売しない',
  },
  preferences: {
    title: 'Cookie設定',
    save: '設定を保存',
    acceptAll: 'すべて許可',
    rejectAll: 'すべて拒否',
    privacyPolicy: 'プライバシーポリシー',
    moreInfo: '詳細',
    moreInfoText: '当社はCookieおよび類似技術を使用して、サービスの提供、保護、改善を行っています。設定はいつでも変更できます。データの取り扱いについての詳細は、プライバシーポリシーをご覧ください。',
    cookieTableName: 'Cookie',
    cookieTableProvider: 'プロバイダー',
    cookieTablePurpose: '目的',
    cookieTableExpiry: '有効期限',
  },
  categories: {
    necessary: {
      label: '必須',
      description: 'ウェブサイトの正常な動作に必要です。無効にできません。',
    },
    analytics: {
      label: '分析',
      description: '訪問者がウェブサイトをどのように利用しているかを理解するのに役立ちます。',
    },
    marketing: {
      label: 'マーケティング',
      description: '関連性の高い広告を表示するために使用されます。',
    },
    preferences: {
      label: '設定',
      description: 'お客様の設定とカスタマイズの選択を記憶します。',
    },
  },
  trigger: {
    ariaLabel: 'プライバシー設定',
  },
  alwaysOnLabel: '常に有効',
  ccpa: {
    linkText: '個人情報を販売・共有しない',
    confirmTitle: '販売・共有の拒否',
    confirmDescription: 'お客様には個人情報の販売または共有を拒否する権利があります。確認すると、マーケティングおよび広告のCookieが無効になります。',
    confirmButton: '拒否を確認',
    cancelButton: 'キャンセル',
    optedOut: '個人情報の販売を拒否しました。',
  },
};
