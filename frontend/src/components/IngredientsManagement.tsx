import React, { useState, useEffect } from 'react';
import { useTenant } from '../context/TenantContext';
import axios from 'axios';

interface Ingredient {
  id: string;
  name: string;
  description?: string;
  sku: string;
  unit: string;
  price: string;
  breakageFactor: string;
  stock: number;
  minimumStock: number;
  active: boolean;
}

interface FormData {
  name: string;
  description: string;
  sku: string;
  unit: string;
  price: string;
  breakageFactor: string;
  stock: string;
  minimumStock: string;
  active: boolean;
}

const INITIAL_FORM: FormData = {
  name: '',
  description: '',
  sku: '',
  unit: 'kg',
  price: '',
  breakageFactor: '0',
  stock: '0',
  minimumStock: '0',
  active: true,
};

export const IngredientsManagement: React.FC = () => {
  const { currentTenant } = useTenant();
  const [ingredients, setIngredients] = useState<Ingredient[]>([]);
  const [formData, setFormData] = useState<FormData>(INITIAL_FORM);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);

  const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:3001';

  // Listar insumos
  useEffect(() => {
    if (currentTenant?.id) {
      fetchIngredients();
    }
  }, [currentTenant?.id]);

  const fetchIngredients = async () => {
    try {
      setLoading(true);
      setError(null);

      const token = localStorage.getItem('auth_token');
      const response = await axios.get(`${API_URL}/api/ingredients`, {
        headers: {
          Authorization: `Bearer ${token}`,
          'X-Tenant-ID': currentTenant?.id,
        },
      });

      setIngredients(response.data.data);
    } catch (err) {
      console.error('[IngredientsManagement] Erro ao buscar:', err);
      setError('Erro ao carregar insumos');
    } finally {
      setLoading(false);
    }
  };

  // Criar ou atualizar
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!formData.name || !formData.sku || !formData.unit || !formData.price) {
      setError('Preench todos os campos obrigatórios');
      return;
    }

    try {
      setLoading(true);
      setError(null);

      const token = localStorage.getItem('auth_token');
      const headers = {
        Authorization: `Bearer ${token}`,
        'X-Tenant-ID': currentTenant?.id,
      };

      if (editingId) {
        // Atualizar
        await axios.put(`${API_URL}/api/ingredients/${editingId}`, formData, {
          headers,
        });
      } else {
        // Criar
        await axios.post(`${API_URL}/api/ingredients`, formData, {
          headers,
        });
      }

      setFormData(INITIAL_FORM);
      setEditingId(null);
      setShowForm(false);
      await fetchIngredients();
    } catch (err) {
      console.error('[IngredientsManagement] Erro ao salvar:', err);
      setError('Erro ao salvar insumo');
    } finally {
      setLoading(false);
    }
  };

  // Editar
  const handleEdit = (ingredient: Ingredient) => {
    setFormData({
      name: ingredient.name,
      description: ingredient.description || '',
      sku: ingredient.sku,
      unit: ingredient.unit,
      price: String(ingredient.price),
      breakageFactor: String(ingredient.breakageFactor),
      stock: String(ingredient.stock),
      minimumStock: String(ingredient.minimumStock),
      active: ingredient.active,
    });
    setEditingId(ingredient.id);
    setShowForm(true);
  };

  // Deletar
  const handleDelete = async (id: string) => {
    if (!confirm('Tem certeza que deseja deletar este insumo?')) {
      return;
    }

    try {
      setLoading(true);
      setError(null);

      const token = localStorage.getItem('auth_token');
      await axios.delete(`${API_URL}/api/ingredients/${id}`, {
        headers: {
          Authorization: `Bearer ${token}`,
          'X-Tenant-ID': currentTenant?.id,
        },
      });

      await fetchIngredients();
    } catch (err) {
      console.error('[IngredientsManagement] Erro ao deletar:', err);
      setError('Erro ao deletar insumo');
    } finally {
      setLoading(false);
    }
  };

  // Cancelar edição
  const handleCancel = () => {
    setFormData(INITIAL_FORM);
    setEditingId(null);
    setShowForm(false);
  };

  return (
    <div style={{ padding: '20px' }}>
      <div style={{ marginBottom: '20px' }}>
        <h2>Gerenciamento de Insumos</h2>
        <p>Tenant: {currentTenant?.name}</p>
      </div>

      {error && (
        <div
          style={{
            padding: '12px',
            marginBottom: '16px',
            backgroundColor: '#fee',
            color: '#c33',
            borderRadius: '4px',
          }}
        >
          {error}
        </div>
      )}

      <button
        onClick={() => {
          if (!showForm) {
            setFormData(INITIAL_FORM);
            setEditingId(null);
            setShowForm(true);
          } else {
            handleCancel();
          }
        }}
        style={{
          padding: '10px 16px',
          marginBottom: '20px',
          backgroundColor: '#007bff',
          color: '#fff',
          border: 'none',
          borderRadius: '4px',
          cursor: 'pointer',
          fontSize: '14px',
        }}
      >
        {showForm ? 'Cancelar' : '+ Novo Insumo'}
      </button>

      {showForm && (
        <form
          onSubmit={handleSubmit}
          style={{
            border: '1px solid #ddd',
            padding: '16px',
            marginBottom: '20px',
            borderRadius: '4px',
          }}
        >
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '16px' }}>
            <div>
              <label style={{ display: 'block', marginBottom: '4px', fontWeight: 'bold' }}>
                Nome *
              </label>
              <input
                type="text"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                style={{
                  width: '100%',
                  padding: '8px',
                  borderRadius: '4px',
                  border: '1px solid #ccc',
                }}
              />
            </div>

            <div>
              <label style={{ display: 'block', marginBottom: '4px', fontWeight: 'bold' }}>
                SKU *
              </label>
              <input
                type="text"
                value={formData.sku}
                onChange={(e) => setFormData({ ...formData, sku: e.target.value })}
                style={{
                  width: '100%',
                  padding: '8px',
                  borderRadius: '4px',
                  border: '1px solid #ccc',
                }}
              />
            </div>

            <div>
              <label style={{ display: 'block', marginBottom: '4px', fontWeight: 'bold' }}>
                Unidade *
              </label>
              <select
                value={formData.unit}
                onChange={(e) => setFormData({ ...formData, unit: e.target.value })}
                style={{
                  width: '100%',
                  padding: '8px',
                  borderRadius: '4px',
                  border: '1px solid #ccc',
                }}
              >
                <option value="kg">kg</option>
                <option value="g">g</option>
                <option value="l">l</option>
                <option value="ml">ml</option>
                <option value="un">un</option>
                <option value="cx">cx</option>
              </select>
            </div>

            <div>
              <label style={{ display: 'block', marginBottom: '4px', fontWeight: 'bold' }}>
                Preço Unitário *
              </label>
              <input
                type="number"
                step="0.01"
                value={formData.price}
                onChange={(e) => setFormData({ ...formData, price: e.target.value })}
                style={{
                  width: '100%',
                  padding: '8px',
                  borderRadius: '4px',
                  border: '1px solid #ccc',
                }}
              />
            </div>

            <div>
              <label style={{ display: 'block', marginBottom: '4px', fontWeight: 'bold' }}>
                Fator de Perda/Quebra (%)
              </label>
              <input
                type="number"
                step="0.01"
                value={formData.breakageFactor}
                onChange={(e) => setFormData({ ...formData, breakageFactor: e.target.value })}
                style={{
                  width: '100%',
                  padding: '8px',
                  borderRadius: '4px',
                  border: '1px solid #ccc',
                }}
              />
            </div>

            <div>
              <label style={{ display: 'block', marginBottom: '4px', fontWeight: 'bold' }}>
                Estoque Mínimo
              </label>
              <input
                type="number"
                value={formData.minimumStock}
                onChange={(e) => setFormData({ ...formData, minimumStock: e.target.value })}
                style={{
                  width: '100%',
                  padding: '8px',
                  borderRadius: '4px',
                  border: '1px solid #ccc',
                }}
              />
            </div>

            <div>
              <label style={{ display: 'block', marginBottom: '4px', fontWeight: 'bold' }}>
                Estoque Atual
              </label>
              <input
                type="number"
                value={formData.stock}
                onChange={(e) => setFormData({ ...formData, stock: e.target.value })}
                style={{
                  width: '100%',
                  padding: '8px',
                  borderRadius: '4px',
                  border: '1px solid #ccc',
                }}
              />
            </div>

            <div>
              <label style={{ display: 'flex', alignItems: 'center', marginTop: '24px' }}>
                <input
                  type="checkbox"
                  checked={formData.active}
                  onChange={(e) => setFormData({ ...formData, active: e.target.checked })}
                  style={{ marginRight: '8px' }}
                />
                Ativo
              </label>
            </div>
          </div>

          <div>
            <label style={{ display: 'block', marginBottom: '4px', fontWeight: 'bold' }}>
              Descrição
            </label>
            <textarea
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              style={{
                width: '100%',
                padding: '8px',
                borderRadius: '4px',
                border: '1px solid #ccc',
                fontFamily: 'inherit',
                minHeight: '80px',
              }}
            />
          </div>

          <div style={{ marginTop: '16px', display: 'flex', gap: '8px' }}>
            <button
              type="submit"
              disabled={loading}
              style={{
                padding: '10px 16px',
                backgroundColor: '#28a745',
                color: '#fff',
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer',
                opacity: loading ? 0.6 : 1,
              }}
            >
              {loading ? 'Salvando...' : editingId ? 'Atualizar' : 'Criar'}
            </button>
            <button
              type="button"
              onClick={handleCancel}
              style={{
                padding: '10px 16px',
                backgroundColor: '#6c757d',
                color: '#fff',
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer',
              }}
            >
              Cancelar
            </button>
          </div>
        </form>
      )}

      <div>
        <h3>Lista de Insumos ({ingredients.length})</h3>
        {loading && !showForm ? (
          <p>Carregando...</p>
        ) : ingredients.length === 0 ? (
          <p>Nenhum insumo cadastrado</p>
        ) : (
          <table
            style={{
              width: '100%',
              borderCollapse: 'collapse',
              fontSize: '14px',
            }}
          >
            <thead>
              <tr style={{ borderBottom: '2px solid #ddd' }}>
                <th style={{ padding: '12px', textAlign: 'left' }}>Nome</th>
                <th style={{ padding: '12px', textAlign: 'left' }}>SKU</th>
                <th style={{ padding: '12px', textAlign: 'left' }}>Unidade</th>
                <th style={{ padding: '12px', textAlign: 'right' }}>Preço</th>
                <th style={{ padding: '12px', textAlign: 'right' }}>Perda %</th>
                <th style={{ padding: '12px', textAlign: 'right' }}>Estoque</th>
                <th style={{ padding: '12px', textAlign: 'right' }}>Min</th>
                <th style={{ padding: '12px', textAlign: 'center' }}>Status</th>
                <th style={{ padding: '12px', textAlign: 'center' }}>Ações</th>
              </tr>
            </thead>
            <tbody>
              {ingredients.map((ingredient) => (
                <tr key={ingredient.id} style={{ borderBottom: '1px solid #eee' }}>
                  <td style={{ padding: '12px' }}>{ingredient.name}</td>
                  <td style={{ padding: '12px' }}>{ingredient.sku}</td>
                  <td style={{ padding: '12px' }}>{ingredient.unit}</td>
                  <td style={{ padding: '12px', textAlign: 'right' }}>
                    R$ {parseFloat(ingredient.price).toFixed(2)}
                  </td>
                  <td style={{ padding: '12px', textAlign: 'right' }}>
                    {parseFloat(ingredient.breakageFactor).toFixed(2)}%
                  </td>
                  <td style={{ padding: '12px', textAlign: 'right' }}>
                    {ingredient.stock}
                    {ingredient.stock < ingredient.minimumStock && (
                      <span style={{ color: '#dc3545', marginLeft: '8px' }}>⚠️</span>
                    )}
                  </td>
                  <td style={{ padding: '12px', textAlign: 'right' }}>{ingredient.minimumStock}</td>
                  <td style={{ padding: '12px', textAlign: 'center' }}>
                    <span style={{ color: ingredient.active ? '#28a745' : '#dc3545' }}>
                      {ingredient.active ? 'Ativo' : 'Inativo'}
                    </span>
                  </td>
                  <td style={{ padding: '12px', textAlign: 'center' }}>
                    <button
                      onClick={() => handleEdit(ingredient)}
                      style={{
                        padding: '6px 12px',
                        marginRight: '8px',
                        backgroundColor: '#007bff',
                        color: '#fff',
                        border: 'none',
                        borderRadius: '4px',
                        cursor: 'pointer',
                        fontSize: '12px',
                      }}
                    >
                      Editar
                    </button>
                    <button
                      onClick={() => handleDelete(ingredient.id)}
                      style={{
                        padding: '6px 12px',
                        backgroundColor: '#dc3545',
                        color: '#fff',
                        border: 'none',
                        borderRadius: '4px',
                        cursor: 'pointer',
                        fontSize: '12px',
                      }}
                    >
                      Deletar
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
};
