/**
 * Polishd — markdown, rendered in the dashboard's own voice.
 *
 * The JSX half of the pair: `markdown-parse.ts` turns a GitHub issue body into
 * an AST, this file turns the AST into elements styled like the rest of the
 * dashboard — same palette, same type scale, links in the same blue. It's a
 * pure function of its input (no state, no effects, no
 * `dangerouslySetInnerHTML`), so it renders identically inside server and
 * client components and costs nothing in the client bundle when used from a
 * server one.
 *
 * External links open in a new tab with `rel="noreferrer noopener"`, and
 * images are capped to the container — issue bodies routinely carry
 * screenshots wider than a drawer.
 */
import type { ReactNode } from "react";

import {
  parseMarkdown,
  type MdBlock,
  type MdInline,
  type MdList,
} from "./markdown-parse";

const codeSpan =
  "rounded bg-[#1a1a1a] px-1 py-0.5 font-mono text-[0.92em] text-[#ddd]";

function renderInline(nodes: MdInline[]): ReactNode {
  return nodes.map((node, i) => {
    switch (node.kind) {
      case "text":
        return node.text;
      case "break":
        return <br key={i} />;
      case "code":
        return (
          <code key={i} className={codeSpan}>
            {node.text}
          </code>
        );
      case "strong":
        return (
          <strong key={i} className="font-semibold text-[#ddd]">
            {renderInline(node.children)}
          </strong>
        );
      case "em":
        return <em key={i}>{renderInline(node.children)}</em>;
      case "del":
        return (
          <del key={i} className="text-[#777]">
            {renderInline(node.children)}
          </del>
        );
      case "link":
        return (
          <a
            key={i}
            href={node.href}
            target="_blank"
            rel="noreferrer noopener"
            className="break-words text-[#8ab4f8] hover:underline"
          >
            {renderInline(node.children)}
          </a>
        );
      case "image":
        return (
          // Plain <img>, not next/image — screenshots live on arbitrary hosts
          // the consumer's image config knows nothing about.
          <img
            key={i}
            src={node.src}
            alt={node.alt}
            loading="lazy"
            className="my-1 max-w-full rounded-md border border-[#2e2e2e]"
          />
        );
    }
  });
}

function List({ list }: { list: MdList }) {
  const Tag = list.ordered ? "ol" : "ul";
  return (
    <Tag
      className={`space-y-1 pl-5 ${
        list.ordered ? "list-decimal" : "list-disc"
      } marker:text-[#555]`}
    >
      {list.items.map((item, i) => (
        <li key={i}>
          {item.checked !== undefined && (
            <span
              aria-hidden
              className={`mr-1.5 font-mono ${item.checked ? "text-emerald-500" : "text-[#555]"}`}
            >
              {item.checked ? "☑" : "☐"}
            </span>
          )}
          {renderInline(item.children)}
          {item.sub && (
            <div className="mt-1">
              <List list={item.sub} />
            </div>
          )}
        </li>
      ))}
    </Tag>
  );
}

const HEADING_CLS: Record<number, string> = {
  1: "text-[15px] font-semibold text-white",
  2: "text-[14px] font-semibold text-white",
  3: "text-[13px] font-semibold text-[#ddd]",
  4: "text-[12px] font-semibold text-[#ddd]",
  5: "text-[12px] font-medium text-[#ccc]",
  6: "text-[11px] font-medium uppercase tracking-[0.08em] text-[#888]",
};

function renderBlock(block: MdBlock, key: number): ReactNode {
  switch (block.kind) {
    case "heading": {
      const Tag = `h${Math.min(block.level + 2, 6)}` as "h3";
      return (
        <Tag key={key} className={`pt-1 ${HEADING_CLS[block.level]}`}>
          {renderInline(block.children)}
        </Tag>
      );
    }
    case "paragraph":
      return <p key={key}>{renderInline(block.children)}</p>;
    case "codeBlock":
      return (
        <pre
          key={key}
          className="overflow-x-auto rounded-md border border-[#2e2e2e] bg-[#111] px-3 py-2.5 font-mono text-[11px] leading-relaxed text-[#aaa]"
        >
          <code>{block.text}</code>
        </pre>
      );
    case "quote":
      return (
        <blockquote
          key={key}
          className="space-y-2 border-l-2 border-[#2e2e2e] pl-3 text-[#888]"
        >
          {block.children.map(renderBlock)}
        </blockquote>
      );
    case "list":
      return <List key={key} list={block.list} />;
    case "rule":
      return <hr key={key} className="border-t border-[#2e2e2e]" />;
    case "table":
      return (
        <div key={key} className="overflow-x-auto">
          <table className="w-full text-left text-[12px]">
            <thead>
              <tr>
                {block.header.map((cell, i) => (
                  <th
                    key={i}
                    className="border-b border-[#2e2e2e] py-1.5 pr-4 font-medium text-[#ddd]"
                  >
                    {renderInline(cell)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, r) => (
                <tr key={r}>
                  {row.map((cell, c) => (
                    <td key={c} className="border-b border-[#1f1f1f] py-1.5 pr-4">
                      {renderInline(cell)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
  }
}

/** GitHub-flavored markdown → dashboard-styled elements. */
export function Markdown({ text }: { text: string }) {
  return (
    <div className="space-y-2.5 break-words text-[13px] leading-relaxed text-[#aaa]">
      {parseMarkdown(text).map(renderBlock)}
    </div>
  );
}
