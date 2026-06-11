export function EmailTemplate({
  nome,
  email,
  telefone,
  cargo,
  organizacao,
  tipoParceria,
  cidadeEstado,
  mensagem,
}: Record<string, string>) {
  const campos = [
    { label: "Nome", valor: nome },
    { label: "E-mail", valor: email },
    { label: "Telefone/WhatsApp", valor: telefone },
    { label: "Cargo/Função", valor: cargo || "—" },
    { label: "Organização", valor: organizacao },
    { label: "Tipo de parceria", valor: tipoParceria },
    { label: "Cidade/Estado", valor: cidadeEstado },
  ];

  return (
    <div
      style={{
        fontFamily: "sans-serif",
        maxWidth: 600,
        margin: "0 auto",
        padding: 24,
      }}
    >
      <div style={{ textAlign: "center", marginBottom: 32 }}>
        <span style={{ fontSize: 32 }}>🤝</span>
        <h1 style={{ color: "#15803d", margin: "8px 0 0" }}>EcoMed</h1>
      </div>

      <h2 style={{ color: "#1a1a1a" }}>Nova solicitação de parceria</h2>
      <p style={{ color: "#555", lineHeight: 1.6 }}>
        Recebida pelo formulário de <strong>ecomed.eco.br/parceiros</strong>.
        Responder em até 48h para: <a href={`mailto:${email}`}>{email}</a>
      </p>

      <table style={{ width: "100%", borderCollapse: "collapse", margin: "24px 0" }}>
        <tbody>
          {campos.map(({ label, valor }) => (
            <tr key={label}>
              <td
                style={{
                  padding: "8px 12px",
                  border: "1px solid #e5e7eb",
                  backgroundColor: "#f9fafb",
                  fontWeight: "bold",
                  color: "#374151",
                  fontSize: 14,
                  width: 180,
                }}
              >
                {label}
              </td>
              <td
                style={{
                  padding: "8px 12px",
                  border: "1px solid #e5e7eb",
                  color: "#111827",
                  fontSize: 14,
                }}
              >
                {valor}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {mensagem && (
        <div
          style={{
            backgroundColor: "#f0fdf4",
            border: "1px solid #bbf7d0",
            borderRadius: 8,
            padding: 16,
            margin: "24px 0",
          }}
        >
          <p style={{ color: "#374151", margin: 0, fontSize: 14, whiteSpace: "pre-wrap" }}>
            <strong>Mensagem:</strong>
            <br />
            {mensagem}
          </p>
        </div>
      )}

      <p style={{ color: "#999", fontSize: 12, textAlign: "center" }}>
        EcoMed — Descarte correto de medicamentos · ecomed.eco.br
      </p>
    </div>
  );
}
