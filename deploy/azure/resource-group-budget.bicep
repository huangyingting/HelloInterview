targetScope = 'resourceGroup'

@description('Monthly conservative ceiling in USD for the shared private-beta hosting resource group.')
@minValue(1)
param monthlyAmount int = 200

@description('First day of the current budget month in UTC, for example 2026-10-01T00:00:00Z.')
param budgetStartDate string

@description('A future first-of-month UTC end date.')
param budgetEndDate string

@description('Existing operated Azure Monitor action group resource ID.')
param actionGroupResourceId string

param budgetName string = 'interview-studio-private-beta-ceiling'

resource budget 'Microsoft.Consumption/budgets@2023-05-01' = {
  name: budgetName
  properties: {
    category: 'Cost'
    amount: monthlyAmount
    timeGrain: 'Monthly'
    timePeriod: {
      startDate: budgetStartDate
      endDate: budgetEndDate
    }
    notifications: {
      actual50: {
        enabled: true
        operator: 'GreaterThanOrEqualTo'
        threshold: 50
        thresholdType: 'Actual'
        contactEmails: []
        contactRoles: []
        contactGroups: [
          actionGroupResourceId
        ]
      }
      actual75: {
        enabled: true
        operator: 'GreaterThanOrEqualTo'
        threshold: 75
        thresholdType: 'Actual'
        contactEmails: []
        contactRoles: []
        contactGroups: [
          actionGroupResourceId
        ]
      }
      actual90: {
        enabled: true
        operator: 'GreaterThanOrEqualTo'
        threshold: 90
        thresholdType: 'Actual'
        contactEmails: []
        contactRoles: []
        contactGroups: [
          actionGroupResourceId
        ]
      }
      actual100: {
        enabled: true
        operator: 'GreaterThanOrEqualTo'
        threshold: 100
        thresholdType: 'Actual'
        contactEmails: []
        contactRoles: []
        contactGroups: [
          actionGroupResourceId
        ]
      }
      forecast100: {
        enabled: true
        operator: 'GreaterThanOrEqualTo'
        threshold: 100
        thresholdType: 'Forecasted'
        contactEmails: []
        contactRoles: []
        contactGroups: [
          actionGroupResourceId
        ]
      }
    }
  }
}
