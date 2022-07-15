import {
  Stack,
  StackProps,
  aws_logs as logs,
  aws_iam as iam,
  aws_ec2 as ec2,
} from "aws-cdk-lib";
import { Construct } from "constructs";

export class TgwStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    // CloudWatch Logs Log Group for VPC Flow Logs
    const flowLogsLogGroup = new logs.LogGroup(this, "Flow Logs Log Group", {
      retention: logs.RetentionDays.ONE_WEEK,
    });

    // SSM IAM Role
    const ssmIamRole = new iam.Role(this, "SSM IAM Role", {
      assumedBy: new iam.ServicePrincipal("ec2.amazonaws.com"),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName(
          "AmazonSSMManagedInstanceCore"
        ),
      ],
    });

    // VPC Flow Logs IAM Role
    const flowLogsIamRole = new iam.Role(this, "Flow Logs IAM Role", {
      assumedBy: new iam.ServicePrincipal("vpc-flow-logs.amazonaws.com"),
    });

    // VPC Flow Logs IAM Policy
    const flowLogsIamPolicy = new iam.Policy(this, "Flow Logs IAM Policy", {
      statements: [
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: ["iam:PassRole"],
          resources: [flowLogsIamRole.roleArn],
        }),
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: [
            "logs:CreateLogStream",
            "logs:PutLogEvents",
            "logs:DescribeLogStreams",
          ],
          resources: [flowLogsLogGroup.logGroupArn],
        }),
      ],
    });

    // Attach VPC Flow Logs IAM Policy to IAM Role
    flowLogsIamRole.attachInlinePolicy(flowLogsIamPolicy);

    // VPC
    const vpcA = new ec2.Vpc(this, "VPC A", {
      cidr: "10.0.1.0/24",
      enableDnsHostnames: true,
      enableDnsSupport: true,
      natGateways: 0,
      maxAzs: 1,
      subnetConfiguration: [
        {
          name: "Public",
          subnetType: ec2.SubnetType.PUBLIC,
          cidrMask: 28,
        },
        {
          name: "Transit Gateway",
          subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
          cidrMask: 28,
        },
      ],
    });

    const vpcB = new ec2.Vpc(this, "VPC B", {
      cidr: "10.0.2.0/24",
      enableDnsHostnames: true,
      enableDnsSupport: true,
      natGateways: 0,
      maxAzs: 1,
      subnetConfiguration: [
        {
          name: "Public",
          subnetType: ec2.SubnetType.PUBLIC,
          cidrMask: 28,
        },
        {
          name: "Transit Gateway",
          subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
          cidrMask: 28,
        },
      ],
    });

    // Security Group
    const vpcAEc2InstanceSG = new ec2.SecurityGroup(
      this,
      "VPC A EC2 Instance SG",
      {
        vpc: vpcA,
        description: "",
        allowAllOutbound: true,
      }
    );
    vpcAEc2InstanceSG.addIngressRule(
      ec2.Peer.ipv4(vpcB.vpcCidrBlock),
      ec2.Port.allTraffic()
    );

    const vpcBEc2InstanceSG = new ec2.SecurityGroup(
      this,
      "VPC B EC2 Instance SG",
      {
        vpc: vpcB,
        description: "",
        allowAllOutbound: true,
      }
    );
    vpcBEc2InstanceSG.addIngressRule(
      ec2.Peer.ipv4(vpcA.vpcCidrBlock),
      ec2.Port.allTraffic()
    );

    // EC2 Instance
    new ec2.Instance(this, "EC2 Instance on VPC A", {
      instanceType: new ec2.InstanceType("t3.micro"),
      machineImage: ec2.MachineImage.latestAmazonLinux({
        generation: ec2.AmazonLinuxGeneration.AMAZON_LINUX_2,
      }),
      vpc: vpcA,
      blockDevices: [
        {
          deviceName: "/dev/xvda",
          volume: ec2.BlockDeviceVolume.ebs(8, {
            volumeType: ec2.EbsDeviceVolumeType.GP3,
          }),
        },
      ],
      propagateTagsToVolumeOnCreation: true,
      vpcSubnets: vpcA.selectSubnets({
        subnetType: ec2.SubnetType.PUBLIC,
      }),
      role: ssmIamRole,
      securityGroup: vpcAEc2InstanceSG,
    });

    new ec2.Instance(this, "EC2 Instance on VPC B", {
      instanceType: new ec2.InstanceType("t3.micro"),
      machineImage: ec2.MachineImage.latestAmazonLinux({
        generation: ec2.AmazonLinuxGeneration.AMAZON_LINUX_2,
      }),
      vpc: vpcB,
      blockDevices: [
        {
          deviceName: "/dev/xvda",
          volume: ec2.BlockDeviceVolume.ebs(8, {
            volumeType: ec2.EbsDeviceVolumeType.GP3,
          }),
        },
      ],
      propagateTagsToVolumeOnCreation: true,
      vpcSubnets: vpcB.selectSubnets({
        subnetType: ec2.SubnetType.PUBLIC,
      }),
      role: ssmIamRole,
      securityGroup: vpcBEc2InstanceSG,
    });

    // Transit Gateway
    const transitGateway = new ec2.CfnTransitGateway(this, "Transit Gateway", {
      amazonSideAsn: 65000,
      autoAcceptSharedAttachments: "enable",
      defaultRouteTableAssociation: "enable",
      defaultRouteTablePropagation: "enable",
      dnsSupport: "enable",
      multicastSupport: "disable",
      tags: [
        {
          key: "Name",
          value: "Transit Gateway",
        },
      ],
    });

    //Transit Gateway attachment
    const transitGatewayAttachmentForVpcA = new ec2.CfnTransitGatewayAttachment(
      this,
      "Transit Gateway attachment for VPC A",
      {
        subnetIds: vpcA.selectSubnets({
          subnetGroupName: "Transit Gateway",
        }).subnetIds,
        transitGatewayId: transitGateway.attrId,
        vpcId: vpcA.vpcId,
        tags: [
          {
            key: "Name",
            value: "Transit Gateway attachment for VPC A",
          },
        ],
      }
    );

    const transitGatewayAttachmentForVpcB = new ec2.CfnTransitGatewayAttachment(
      this,
      "Transit Gateway attachment for VPC B",
      {
        subnetIds: vpcB.selectSubnets({
          subnetGroupName: "Transit Gateway",
        }).subnetIds,
        transitGatewayId: transitGateway.attrId,
        vpcId: vpcB.vpcId,
        tags: [
          {
            key: "Name",
            value: "Transit Gateway attachment for VPC B",
          },
        ],
      }
    );

    // Route Table
    vpcA
      .selectSubnets({ subnetType: ec2.SubnetType.PUBLIC })
      .subnets.map((subnet, index) => {
        new ec2.CfnRoute(
          this,
          `Route to Transit Gateway of public subnet in VPC A ${index}`,
          {
            routeTableId: subnet.routeTable.routeTableId,
            destinationCidrBlock: vpcB.vpcCidrBlock,
            transitGatewayId: transitGateway.ref,
          }
        ).addDependsOn(transitGatewayAttachmentForVpcA);
      });

    vpcB
      .selectSubnets({ subnetType: ec2.SubnetType.PUBLIC })
      .subnets.map((subnet, index) => {
        new ec2.CfnRoute(
          this,
          `Route to Transit Gateway of public subnet in VPC B ${index}`,
          {
            routeTableId: subnet.routeTable.routeTableId,
            destinationCidrBlock: vpcA.vpcCidrBlock,
            transitGatewayId: transitGateway.ref,
          }
        ).addDependsOn(transitGatewayAttachmentForVpcB);
      });
  }
}
