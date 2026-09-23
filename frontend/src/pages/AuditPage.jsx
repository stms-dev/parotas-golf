import { useEffect, useState } from 'react';

import { auditApi } from '../api/client';
import { Alert, Badge, Card, Field, Select, Spinner, Table } from '../components/ui';
import { fechaHora } from '../utils/format';

const ACCIONES = {
  CREAR: 'Creación',
  MODIFICAR: 'Modificación',
  ELIMINAR: 'Eliminación',
  CONFIRMAR: 'Confirmación',
  CANCELAR: 'Cancelación',
  CHECK_IN: 'Check-in',
  PAGO: 'Pago',
  CIERRE_CAJA: 'Cierre de caja',
  VALIDAR_PGA: 'Validación PGA',
  LOGIN: 'Inicio de sesión',
};

const MODULOS = ['identity', 'catalog', 'booking', 'checkin', 'billing', 'treasury', 'events'];

export default function AuditPage() {
  const [filters, setFilters] = useState({ module: '', action: '' });
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    setLoading(true);
    auditApi
      .list({ ...filters, limit: 200 })
      .then(setRows)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [filters]);

  return (
    <div className="space-y-6">
      <header>
        <p className="text-body-md uppercase tracking-widest text-secondary">Trazabilidad</p>
        <h1 className="font-serif text-3xl text-primary">Bitácora de auditoría</h1>
        <p className="text-body-lg text-outline">
          Cada cambio crítico queda con usuario, fecha, valor anterior y valor nuevo.
        </p>
      </header>

      {error && <Alert tone="error">{error}</Alert>}

      <Card>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Módulo">
            <Select value={filters.module} onChange={(e) => setFilters({ ...filters, module: e.target.value })}>
              <option value="">Todos</option>
              {MODULOS.map((modulo) => (
                <option key={modulo} value={modulo}>
                  {modulo}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Acción">
            <Select value={filters.action} onChange={(e) => setFilters({ ...filters, action: e.target.value })}>
              <option value="">Todas</option>
              {Object.entries(ACCIONES).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      </Card>

      <Card title={`${rows.length} registros`}>
        {loading ? (
          <Spinner />
        ) : (
          <Table
            columns={['Fecha y hora', 'Usuario', 'Acción', 'Parámetro', 'Anterior', 'Nuevo']}
            rows={rows}
            empty="Sin registros con esos filtros"
            renderRow={(row) => (
              <tr key={row.id} className="hover:bg-surface-container-low">
                <td className="px-3 py-2 font-mono text-body-md text-on-surface-variant">{fechaHora(row.created_at)}</td>
                <td className="px-3 py-2">{row.user_name || 'Sistema'}</td>
                <td className="px-3 py-2">
                  <Badge>{ACCIONES[row.action] || row.action}</Badge>
                  <span className="ml-2 text-body-md text-outline">{row.module}</span>
                </td>
                <td className="px-3 py-2 text-on-surface-variant">
                  {row.description || `${row.entity}${row.field ? ` · ${row.field}` : ''}`}
                </td>
                <td className="px-3 py-2 font-mono text-body-md text-outline">{row.old_value || '—'}</td>
                <td className="px-3 py-2 font-mono text-body-md font-medium">{row.new_value || '—'}</td>
              </tr>
            )}
          />
        )}
      </Card>
    </div>
  );
}
