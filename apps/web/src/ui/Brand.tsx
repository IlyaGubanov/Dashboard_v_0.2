import { useAppearance } from './appearance';

/** Официальный знак без изменения пропорций и цветов; название и подпись — из настроек оформления. */
export function Brand() {
  const { appearance: a } = useAppearance();
  return (
    <div className="brand" translate="no">
      <img src="/brand/logo.svg" width={44} height={44} alt={`Логотип ${a.brandName}`} />
      <div className="brand-copy">
        <div className="brand-name">{a.brandName}</div>
        {a.brandCaption && <div className="brand-caption">{a.brandCaption}</div>}
      </div>
    </div>
  );
}
