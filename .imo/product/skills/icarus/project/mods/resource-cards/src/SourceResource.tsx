import { Chip } from "@david/components/ui/Chip";
import type { ServiceResource } from "./schema";
import "./resource.css";
/** A data-driven resource explanation; kind does not select business-specific logic. */
export function SourceResource({ resource }: { resource: ServiceResource }) {
  return (
    <section
      className="research-resource"
      data-resource-kind={resource.kind}
      data-resource-id={resource.id}
      data-resource-state={resource.status?.state}
    >
      <header>
        <h4>
          {resource.href ? (
            <a
              className="research-resource-title-link"
              href={resource.href}
              target="_blank"
              rel="noopener noreferrer"
            >
              {resource.title}
            </a>
          ) : (
            resource.title
          )}
        </h4>
        <Chip tone="accent">{resource.kind}</Chip>
      </header>
      {resource.description && <p>{resource.description}</p>}
      {resource.status && (
        <p className="research-resource-status">
          <strong>{resource.status.label}</strong>
          {resource.status.detail && <> · {resource.status.detail}</>}
        </p>
      )}
      <dl>
        {resource.fields.map((field) => (
          <div key={field.label}>
            <dt>{field.label}</dt>
            <dd>
              {field.href ? (
                <a
                  className="research-resource-field-link"
                  href={field.href}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {field.value}
                </a>
              ) : (
                field.value
              )}
            </dd>
          </div>
        ))}
      </dl>
      {resource.notice && (
        <p className="research-resource-notice">{resource.notice}</p>
      )}
      <div className="research-resource-links">
        {resource.href && (
          <a
            className="research-resource-link"
            href={resource.href}
            target="_blank"
            rel="noopener noreferrer"
          >
            {resource.linkLabel ?? "打开资源页面"}{" "}
            <span aria-hidden="true">↗</span>
          </a>
        )}
        {resource.links?.map((link) => (
          <a
            className="research-resource-link"
            key={link.href}
            href={link.href}
            target="_blank"
            rel="noopener noreferrer"
          >
            {link.label} ↗
          </a>
        ))}
      </div>
    </section>
  );
}
