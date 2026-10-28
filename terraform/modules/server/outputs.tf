# SERVER MODULE OUTPUTS: WHAT THE ROOT MODULE CAN READ BACK

output "instance_profile_name" {
  value = aws_iam_instance_profile.server_profile.name # PICK THIS UNDER "IAM INSTANCE PROFILE" WHEN LAUNCHING THE INSTANCE
}
