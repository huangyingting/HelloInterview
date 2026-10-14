# Private-beta Azure cost control

Issue [#53](https://github.com/huangyingting/HelloInterview/issues/53) implements the approved USD 200 monthly ceiling as an Azure Cost Management budget.

## Honest scope

Interview Studio shares the existing `WEBSTACK` resource group and VM with sibling services. Azure cannot attribute shared VM, disk, network and supporting-resource charges precisely to this application without a separate deployment boundary. The budget therefore covers the **entire resource group** as a conservative upper-bound proxy: unrelated resource-group spend can trigger an early alert, but Interview Studio cannot exceed the monitored group total.

Do not describe this budget as exact per-application accounting. Separate resources, tags and allocation rules are required before application-only cost can be claimed.

## Repository-owned configuration

`deploy/azure/resource-group-budget.bicep` creates a monthly cost budget with:

- amount: USD 200;
- actual notifications at 50%, 75%, 90% and 100%;
- forecasted notification at 100%;
- delivery through an existing enabled Azure Monitor action group;
- no committed contact address, subscription ID or action-group ID.

The start date must be the first day of the current budget month. The end date is an explicit future first-of-month UTC date. Deployment supplies the existing action-group resource ID privately:

```bash
az deployment group create \
  --resource-group WEBSTACK \
  --template-file deploy/azure/resource-group-budget.bicep \
  --parameters \
    budgetStartDate=YYYY-MM-01T00:00:00Z \
    budgetEndDate=YYYY-MM-01T00:00:00Z \
    actionGroupResourceId='<existing-operated-action-group-resource-id>'
```

The deployment must read the budget back and verify its amount, scope, time grain, dates, five enabled notification thresholds, threshold types, and linkage to the intended action group without publishing subscription or receiver identifiers.

## Operating response

`huangyingting` owns the private-beta spend response:

- **50% actual:** review resource-group cost analysis and identify unusual growth.
- **75% actual:** defer nonessential capacity or paid-provider changes; review remaining invite scope.
- **90% actual or 100% forecast:** freeze new cost-bearing rollout and prepare to keep the beta closed or reduce capacity.
- **100% actual:** do not automatically stop the shared VM because that would interrupt sibling services. Keep Interview Studio disabled or unavailable, investigate attribution, and make an explicit owner decision before further spend.

Budget notifications are delayed cost signals, not real-time enforcement. Review Cost Management at least weekly during the invite-only beta and after every capacity/provider change. Record anomalies and owner decisions in the infrastructure issue.

This control does not prove exact Interview Studio attribution, enforce a hard shutdown, approve paid AI/billing, or replace guest CPU/memory/disk monitoring.
