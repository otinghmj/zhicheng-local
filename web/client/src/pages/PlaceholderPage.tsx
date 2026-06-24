type PlaceholderPageProps = {
  title: string;
  description: string;
};

export function PlaceholderPage({ title, description }: PlaceholderPageProps) {
  return (
    <main className="app-page">
      <div className="app-page__head">
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      <section className="app-placeholder">
        <h2>{title}页面占位</h2>
        <p>当前已接入全局布局和路由，具体数据与页面内容将在后续步骤实现。</p>
      </section>
    </main>
  );
}
