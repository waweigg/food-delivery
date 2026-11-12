import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';
import 'api_client.dart';
import 'menu_screens.dart' show priceText;

class PaymentScreen extends StatefulWidget {
  const PaymentScreen({super.key,required this.api, required this.orderId});
  final ApiClient api;
  final String orderId;
  @override
  State<PaymentScreen> createState()=>_PaymentScreenState();
}

class _PaymentScreenState extends State<PaymentScreen> {
  Map<String,dynamic>? attempt;
  String? error;
  bool busy=false;
  @override
  void initState(){super.initState();request(start:true);}
  Future<void> request({bool start=false, String? token}) async {
    if(busy)return;
    setState((){busy=true;error=null;});
    try {
      final id=attempt?['id'];
      final result=await widget.api.request(
        start?'/payments':token==null?'/payments/$id':'/payments/$id/confirm',
        body:start?{'orderId':widget.orderId}:token==null?null:{'methodToken':token});
      if(mounted)setState(()=>attempt=Map<String,dynamic>.from(result as Map));
    } on ApiException catch(e){
      if(mounted)setState(()=>error=e.status==401?e.message:'Could not confirm the payment status. Check again before retrying.');
    } finally {if(mounted)setState(()=>busy=false);}
  }
  Future<void> hosted(String value)async{
    final url=Uri.tryParse(value);
    if(url==null||url.scheme!='https'||url.host!='checkout.stripe.com')return;
    try{if(await launchUrl(url,mode:LaunchMode.externalApplication))return;}catch(_){}
    if(mounted)setState(()=>error='Could not open hosted checkout. Try again.');
  }
  @override
  Widget build(BuildContext context){
    final a=attempt;
    final status=a?['status'];
    final local=a?['provider']=='local-test';
    return Scaffold(appBar:AppBar(title:const Text('Test payment')),body:ListView(padding:const EdgeInsets.all(24),children:[
      if(a!=null)...[
        Text(local?'Local payment simulator':'Stripe test checkout',style:Theme.of(context).textTheme.titleLarge),
        const SizedBox(height:12),Text('INR ${priceText(a['amountMinor'] as int)}',style:Theme.of(context).textTheme.headlineLarge),
        Text('Order ${widget.orderId.substring(0,8)}'),
        const SizedBox(height:18),
        if(status=='PENDING' && local)...[
          const Text('Choose a test result. No card details or money are needed.'),
          FilledButton(onPressed:busy?null:()=>request(token:'test_approve'),child:const Text('Approve test payment')),
          OutlinedButton(onPressed:busy?null:()=>request(token:'test_decline'),child:const Text('Simulate decline')),
          TextButton(onPressed:busy?null:()=>request(token:'test_abandon'),child:const Text('Abandon test payment')),
        ],
        if(status=='PENDING' && !local && a['checkoutUrl']!=null)
          FilledButton(onPressed:busy?null:()=>hosted(a['checkoutUrl'] as String),child:const Text('Open hosted test checkout')),
        if(status=='SUCCEEDED')...[
          const Icon(Icons.check_circle,color:Colors.green,size:54),const Text('Test payment successful',textAlign:TextAlign.center),
          SelectableText('Reference: ${a['reference']}',textAlign:TextAlign.center),
          FilledButton(onPressed:()=>Navigator.pop(context,true),child:const Text('Done')),
        ],
        if(status=='FAILED'||status=='ABANDONED')...[
          Text(status=='FAILED'?'Payment declined. The order is unpaid.':'Checkout abandoned. The order is unpaid.'),
          FilledButton(onPressed:busy?null:()=>request(start:true),child:const Text('Try another test payment')),
        ],
      ],
      if(busy)const LinearProgressIndicator(),
      if(error!=null)Text(error!),
      if(!busy && (status=='PENDING'||error!=null))
        TextButton(onPressed:()=>request(start:a==null),child:const Text('Check payment status')),
    ]));
  }
}
