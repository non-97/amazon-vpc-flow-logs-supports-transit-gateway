#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { TgwStack } from '../lib/tgw-stack';

const app = new cdk.App();
new TgwStack(app, 'TgwStack');