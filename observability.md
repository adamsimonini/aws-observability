## Cloud Watch

CloudWatch > Logs > Log groups

```bash
fields @timestamp, @message
| sort @timestamp desc
| limit 20

```

```bash
aws ecs put-account-setting --name containerInsights --value enhanced
```
