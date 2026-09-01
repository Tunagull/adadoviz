import { forwardRef, useId } from "react";
import { ChevronDown } from "lucide-react";

/**
 * Yüzen etiketli form alanı.
 *
 * Kaynak bileşen shadcn'in `Input`/`Label` primitifleri ve `cn` yardımcısı
 * üzerine kuruluydu; ikisi de bu kod tabanında yok. Görsel davranışın tamamı
 * `index.css` içindeki `.float-field` katmanında — burada yalnızca doğru
 * iskelet ve durum öznitelikleri üretiliyor.
 *
 * Etiket iki yerde birden geçiyor, bu bilinçli:
 *   - `<label>`   → ekran okuyucunun ve tıklamanın gördüğü gerçek etiket
 *   - `<legend>`  → yalnızca kenarlıkta AÇILACAK BOŞLUĞUN genişliğini ölçen,
 *                   görünmez kopya (`aria-hidden` bir fieldset içinde)
 *
 * Yer tutucu her zaman tek boşluk: `:placeholder-shown` yalnızca böyle
 * "alan boş mu" sorusunun karşılığı olur. Gerçek bir biçim ipucu vermek
 * isteyen alan `placeholder` gönderebilir; o ipucu CSS'te sadece alan
 * odaktayken görünür.
 */
const FloatingField = forwardRef(function FloatingField(
  {
    as = "input",
    id,
    label,
    icon: Icon,
    hint,
    error,
    invalid,
    /** "always": etiket hep yukarıda durur. Alanın içinde her zaman görünen
     *  bir şey olduğunda (telefon maskesi, sabit önek) gerekiyor. */
    float,
    /** Alanın içine yerleşen ek katman: önek, maske hayaleti, birim vb. */
    adornment,
    /** "sm": araç çubuğu yüksekliği (2.25rem). Varsayılan 2.75rem. */
    size,
    className = "",
    fieldClassName = "",
    controlClassName = "",
    children,
    placeholder,
    ...rest
  },
  ref
) {
  const autoId = useId();
  const fieldId = id || `field-${autoId}`;
  const messageId = `${fieldId}-message`;
  const message = error || hint;
  const isInvalid = Boolean(error) || invalid;

  const Tag = as;
  const isSelect = as === "select";
  const isMultiline = as === "textarea";

  const controlProps = {
    id: fieldId,
    className: `float-field__control ${controlClassName}`,
    "aria-invalid": isInvalid || undefined,
    "aria-describedby": message ? messageId : undefined,
    ...rest,
  };

  return (
    <div className={className}>
      <div
        className={`float-field ${fieldClassName}`}
        data-icon={Icon ? "" : undefined}
        data-select={isSelect ? "" : undefined}
        data-multiline={isMultiline ? "" : undefined}
        data-invalid={isInvalid ? "" : undefined}
        data-float={float}
        data-size={size}
      >
        {/* `input` boş elemandır; children'ı yalnızca select ve textarea alır. */}
        {isSelect ? (
          <Tag ref={ref} {...controlProps}>
            {children}
          </Tag>
        ) : (
          <Tag ref={ref} placeholder={placeholder || " "} {...controlProps} />
        )}

        {Icon ? <Icon className="float-field__icon size-4" aria-hidden="true" /> : null}
        {adornment}

        <label htmlFor={fieldId} className="float-field__label">
          {label}
        </label>

        {isSelect ? (
          <ChevronDown className="float-field__chevron size-4" aria-hidden="true" />
        ) : null}

        <fieldset aria-hidden="true" className="float-field__outline">
          <legend>
            <span>{label}</span>
          </legend>
        </fieldset>
      </div>

      {message ? (
        <p
          id={messageId}
          className={`mt-1.5 text-xs ${
            error ? "text-danger-600 dark:text-danger-400" : "text-ink-500 dark:text-ink-400"
          }`}
        >
          {message}
        </p>
      ) : null}
    </div>
  );
});

/**
 * Salt okunur sonuç kutusu: hesap makinelerinin çıktısı, girdi alanlarının tam
 * yanında duruyor. Aynı iskeleti kullanmasa aynı satırda iki farklı etiket
 * dili görünürdü (biri kutunun içinde, diğeri üstünde).
 */
export function FloatingDisplay({
  label,
  children,
  className = "",
  fieldClassName = "",
  valueClassName = "",
  muted = false,
}) {
  return (
    <div className={className}>
      <div className={`float-field ${fieldClassName}`} data-float="always">
        <div className={`float-field__control float-field__display ${valueClassName}`}>
          <span className={`truncate ${muted ? "text-ink-500 dark:text-ink-400" : ""}`}>
            {children}
          </span>
        </div>
        <span className="float-field__label">{label}</span>
        <fieldset aria-hidden="true" className="float-field__outline">
          <legend>
            <span>{label}</span>
          </legend>
        </fieldset>
      </div>
    </div>
  );
}

export const FloatingInput = forwardRef(function FloatingInput(props, ref) {
  return <FloatingField as="input" ref={ref} {...props} />;
});

export const FloatingTextarea = forwardRef(function FloatingTextarea(props, ref) {
  return <FloatingField as="textarea" ref={ref} {...props} />;
});

export const FloatingSelect = forwardRef(function FloatingSelect(props, ref) {
  return <FloatingField as="select" ref={ref} {...props} />;
});

export { FloatingField };
