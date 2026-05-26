type Props = {
  role: "user" | "assistant";
  text: string;
};

export default function ChatBubble({ role, text }: Props) {
  const isUser = role === "user";
  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-lg rounded-2xl px-4 py-3 text-sm leading-6 shadow-card ${
          isUser
            ? "bg-[#123f2a] text-white"
            : "border border-[#e7e2d9] bg-white text-[#1d1c16]"
        }`}
      >
        {text}
      </div>
    </div>
  );
}
