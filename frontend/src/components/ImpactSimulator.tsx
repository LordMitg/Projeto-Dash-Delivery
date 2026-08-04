import React, { useState } from 'react';
import { PageHeader, Card, FormGroup, CardGrid, KPICard } from './Layout';
import { useTenant } from '../context/TenantContext';

interface SimulationResult {
  scenario: string;
  revenueNeeded: number;
  profitMargin: number;
  salaryImpact: number;
  taxImpact: number;
  finalProfit: number;
  roi: number;
}

export const ImpactSimulator: React.FC = () => {
  const { activeTenant } = useTenant();
  const [formData, setFormData] = useState({
    currentRevenue: 50000,
    currentCMVPerc: 35,
    currentSalaries: 15000,
    currentTaxRate: 15,
    // Simulações
    newStaffCount: 2,
    newStaffSalary: 3000,
    newDeliveryVehicles: 1,
    vehicleCost: 0,
    expectedRevenueIncrease: 20, // %
  });

  const [results, setResults] = useState<SimulationResult | null>(null);

  const calculateImpact = () => {
    const {
      currentRevenue,
      currentCMVPerc,
      currentSalaries,
      currentTaxRate,
      newStaffCount,
      newStaffSalary,
      newDeliveryVehicles,
      vehicleCost,
      expectedRevenueIncrease,
    } = formData;

    // Cenário atual
    const currentCMV = currentRevenue * (currentCMVPerc / 100);
    const currentGrossProfit = currentRevenue - currentCMV;
    const currentTaxes = currentGrossProfit * (currentTaxRate / 100);
    const currentNetProfit = currentGrossProfit - currentSalaries - currentTaxes;

    // Cenário com mudanças
    const newRevenue = currentRevenue * (1 + expectedRevenueIncrease / 100);
    const newCMV = newRevenue * (currentCMVPerc / 100);
    const newGrossProfit = newRevenue - newCMV;

    const totalNewSalaries = currentSalaries + newStaffCount * newStaffSalary;
    const vehicleDepreciation = (newDeliveryVehicles * vehicleCost) / 60; // 5 anos

    const newOperatingExpenses = totalNewSalaries + vehicleDepreciation;
    const newTaxes = newGrossProfit * (currentTaxRate / 100);
    const newNetProfit = newGrossProfit - newOperatingExpenses - newTaxes;

    const profitImprovement = newNetProfit - currentNetProfit;
    const investmentCost = newDeliveryVehicles * vehicleCost;
    const paybackMonths = investmentCost > 0 ? (investmentCost / (profitImprovement / 12)) : 0;

    setResults({
      scenario: `+${newStaffCount} colaboradores, +${newDeliveryVehicles} veículos`,
      revenueNeeded: newRevenue,
      profitMargin: (newNetProfit / newRevenue) * 100,
      salaryImpact: totalNewSalaries,
      taxImpact: newTaxes,
      finalProfit: newNetProfit,
      roi: paybackMonths > 0 ? ((profitImprovement / investmentCost) * 100) : 0,
    });
  };

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
      <PageHeader 
        title="Simulador de Impacto"
        subtitle={activeTenant?.name}
        actions={
          <button className="btn btn-primary" onClick={calculateImpact}>
            Calcular Impacto
          </button>
        }
      />

      <div style={{ flex: 1, overflow: 'auto', padding: 'var(--spacing-lg)' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--spacing-lg)', maxWidth: '1200px' }}>
          {/* Painel de Entrada */}
          <Card title="Cenário Atual">
            <FormGroup label="Receita Mensal (R$)">
              <input
                type="number"
                value={formData.currentRevenue}
                onChange={(e) => setFormData({ ...formData, currentRevenue: parseFloat(e.target.value) })}
              />
            </FormGroup>

            <FormGroup label="CMV (%)">
              <input
                type="number"
                min="0"
                max="100"
                step="0.1"
                value={formData.currentCMVPerc}
                onChange={(e) => setFormData({ ...formData, currentCMVPerc: parseFloat(e.target.value) })}
              />
            </FormGroup>

            <FormGroup label="Total de Salários (R$)">
              <input
                type="number"
                value={formData.currentSalaries}
                onChange={(e) => setFormData({ ...formData, currentSalaries: parseFloat(e.target.value) })}
              />
            </FormGroup>

            <FormGroup label="Taxa de Imposto (%)">
              <input
                type="number"
                min="0"
                max="100"
                step="0.1"
                value={formData.currentTaxRate}
                onChange={(e) => setFormData({ ...formData, currentTaxRate: parseFloat(e.target.value) })}
              />
            </FormGroup>
          </Card>

          {/* Painel de Mudanças */}
          <Card title="Simulação de Mudanças">
            <FormGroup label="Novos Colaboradores">
              <input
                type="number"
                min="0"
                value={formData.newStaffCount}
                onChange={(e) => setFormData({ ...formData, newStaffCount: parseInt(e.target.value) })}
              />
            </FormGroup>

            <FormGroup label="Salário por Colaborador (R$)">
              <input
                type="number"
                value={formData.newStaffSalary}
                onChange={(e) => setFormData({ ...formData, newStaffSalary: parseFloat(e.target.value) })}
              />
            </FormGroup>

            <FormGroup label="Novos Veículos de Entrega">
              <input
                type="number"
                min="0"
                value={formData.newDeliveryVehicles}
                onChange={(e) => setFormData({ ...formData, newDeliveryVehicles: parseInt(e.target.value) })}
              />
            </FormGroup>

            <FormGroup label="Custo por Veículo (R$)">
              <input
                type="number"
                value={formData.vehicleCost}
                onChange={(e) => setFormData({ ...formData, vehicleCost: parseFloat(e.target.value) })}
              />
            </FormGroup>

            <FormGroup label="Aumento de Receita Esperado (%)">
              <input
                type="number"
                min="0"
                max="100"
                step="1"
                value={formData.expectedRevenueIncrease}
                onChange={(e) => setFormData({ ...formData, expectedRevenueIncrease: parseFloat(e.target.value) })}
              />
            </FormGroup>
          </Card>
        </div>

        {/* Resultados */}
        {results && (
          <div style={{ marginTop: 'var(--spacing-lg)' }}>
            <Card title="Resultados da Simulação">
              <p className="font-semibold" style={{ marginBottom: 'var(--spacing-md)' }}>
                {results.scenario}
              </p>

              <CardGrid columns={4}>
                <KPICard
                  label="Receita Projetada"
                  value={results.revenueNeeded}
                  currency
                  icon="📊"
                />
                <KPICard
                  label="Margem de Lucro"
                  value={`${results.profitMargin.toFixed(2)}%`}
                  icon="📈"
                />
                <KPICard
                  label="Total de Salários"
                  value={results.salaryImpact}
                  currency
                  icon="👥"
                />
                <KPICard
                  label="Impostos"
                  value={results.taxImpact}
                  currency
                  icon="🏛️"
                />
              </CardGrid>

              <div style={{ marginTop: 'var(--spacing-lg)', padding: 'var(--spacing-lg)', backgroundColor: 'var(--neutral-50)', borderRadius: 'var(--radius-lg)', borderLeft: '4px solid var(--success)' }}>
                <p style={{ fontSize: '0.875rem', color: 'var(--neutral-600)', margin: 0 }}>Lucro Líquido Projetado</p>
                <p style={{ fontSize: '2rem', fontWeight: 'bold', color: 'var(--success)', margin: '8px 0 0 0' }}>
                  R$ {results.finalProfit.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}
                </p>
                {results.roi > 0 && (
                  <p style={{ fontSize: '0.875rem', color: 'var(--neutral-600)', margin: '8px 0 0 0' }}>
                    ROI: {results.roi.toFixed(2)}%
                  </p>
                )}
              </div>
            </Card>
          </div>
        )}
      </div>
    </div>
  );
};
