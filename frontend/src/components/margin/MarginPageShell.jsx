function MarginPageShell({ title, subtitle, actions, children, badge }) {
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-emerald-50 text-slate-900">
      <div className="relative overflow-hidden">
        <div className="absolute inset-0 pointer-events-none">
          <div className="absolute -left-10 -top-10 w-72 h-72 bg-emerald-100 rounded-full mix-blend-multiply blur-3xl opacity-40" />
          <div className="absolute -right-10 top-16 w-80 h-80 bg-indigo-100 rounded-full mix-blend-multiply blur-3xl opacity-30" />
          <div className="absolute inset-x-0 top-24 h-px bg-gradient-to-r from-transparent via-slate-200 to-transparent" />
        </div>
        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-10 py-8 space-y-6">
          <div className="bg-white/80 backdrop-blur-xl border border-slate-100/70 shadow-lg shadow-slate-200/30 rounded-3xl px-6 py-5 flex flex-wrap items-start justify-between gap-4">
            <div className="space-y-2">
              <div className="flex items-center gap-3">
                {badge && (
                  <span className="px-3 py-1 rounded-full text-xs font-semibold bg-slate-900 text-white shadow">
                    {badge}
                  </span>
                )}
                <span className="text-[11px] uppercase tracking-[0.18em] text-slate-400">Margin workspace</span>
              </div>
              <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight text-slate-900">
                {title}
              </h1>
              {subtitle && (
                <p className="text-sm sm:text-base text-slate-600 max-w-2xl">
                  {subtitle}
                </p>
              )}
            </div>
            {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
          </div>
          {children}
        </div>
      </div>
    </div>
  );
}

export default MarginPageShell;
