/** Официальный знак без изменения пропорций и цветов; текст остаётся доступным на телефоне. */
export function Brand() {
  return (
    <div className="brand" translate="no">
      <img src="/brand/logo.svg" width={44} height={44} alt="Логотип МосводостокСтройТрест" />
      <div className="brand-copy">
        <div className="brand-name">МосводостокСтройТрест</div>
        <div className="brand-caption">Информационно-аналитическая система</div>
      </div>
    </div>
  );
}
