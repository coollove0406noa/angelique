import React from "react";

/**
 * テキスト内のURLを検出してクリック可能なリンクに変換するコンポーネント
 * 改行も保持する（white-space: pre-wrap相当）
 */
// URLを検出する正規表現（末尾の句読点・括弧は除外）
const URL_REGEX = /(https?:\/\/[^\s\n.,;:!?\)\]]+)/g;

type Props = {
  text: string;
  className?: string;
  style?: React.CSSProperties;
};

export default function LinkifiedText({ text, className, style }: Props) {
  // URLを検出してパーツに分割
  const parts = text.split(URL_REGEX);

  // URL_REGEXを使い回すとlastIndexがずれるためリセット
  URL_REGEX.lastIndex = 0;

  return (
    <span className={className} style={{ whiteSpace: "pre-wrap", wordBreak: "break-word", ...style }}>
      {parts.map((part, i) => {
        // splitの仕様上、奇数インデックスがURL部分
        if (i % 2 === 1) {
          return (
            <a
              key={i}
              href={part}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                color: "#c9a8a3",
                textDecoration: "underline",
                wordBreak: "break-all",
              }}
              onClick={(e) => e.stopPropagation()}
            >
              {part}
            </a>
          );
        }
        return <React.Fragment key={i}>{part}</React.Fragment>;
      })}
    </span>
  );
}
