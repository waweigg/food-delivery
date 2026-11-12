import 'dart:async';
import 'package:flutter/material.dart';
import 'api_client.dart';
import 'menu_screens.dart' show priceText;

const kitchenLabels={'NEW':'Awaiting acceptance','ACCEPTED':'Accepted','PREPARING':'Preparing','READY':'Ready for pickup','REJECTED':'Rejected','EXPIRED':'Expired'};

class KitchenScreen extends StatefulWidget {
  const KitchenScreen({super.key,required this.api,required this.path,this.orderId,this.recovery=false});
  final ApiClient api;
  final String path;
  final String? orderId;
  final bool recovery;
  @override
  State<KitchenScreen> createState()=>_KitchenState();
}
class _KitchenState extends State<KitchenScreen>{
  List<dynamic> rows=[];
  Map<String,dynamic>? ticket;
  bool busy=false, loaded=false;
  String? error;
  int minutes=20;
  Timer? timer;
  String get endpoint=>widget.orderId==null?widget.path:'${widget.path}/${widget.orderId}';
  @override
  void initState(){
    super.initState();load();
    timer=Timer.periodic(const Duration(seconds:8),(_){if(ModalRoute.of(context)?.isCurrent==true)load();});
  }
  @override
  void dispose(){timer?.cancel();super.dispose();}
  Future<void> load()async{
    if(busy){return;}
    busy=true;
    try{
      final result=await widget.api.request(endpoint);
      if(mounted){setState((){
        if(widget.orderId==null){rows=result as List;}else{ticket=Map<String,dynamic>.from(result as Map);}
        error=null;loaded=true;
      });}
    }on ApiException catch(e){if(mounted)setState(()=>error=e.message);}
    finally{if(mounted)setState(()=>busy=false);}
  }
  Future<void> act(String action,{String? reason})async{
    if(busy){return;}
    setState((){busy=true;error=null;});
    try{
      await widget.api.request('$endpoint/$action',body:{if(action=='accept')'minutes':minutes,'reason':?reason});
      final current=await widget.api.request(endpoint);
      if(mounted)setState(()=>ticket=Map<String,dynamic>.from(current as Map));
    }on ApiException catch(e){if(mounted)setState(()=>error=e.message);}
    finally{if(mounted)setState(()=>busy=false);}
  }
  Future<void> reject()async{
    String reason='';
    final confirmed=await showDialog<bool>(context:context,builder:(ctx)=>AlertDialog(
      title:const Text('Reject paid order?'),content:TextField(maxLength:300,onChanged:(v)=>reason=v.trim(),decoration:const InputDecoration(labelText:'Reason for refund review')),
      actions:[TextButton(onPressed:()=>Navigator.pop(ctx,false),child:const Text('Keep order')),TextButton(onPressed:()=>Navigator.pop(ctx,true),child:const Text('Reject order'))],
    ));
    if(!mounted||confirmed!=true)return;
    if(reason.isEmpty){setState(()=>error='Enter a reason before rejecting an order.');return;}
    await act('reject',reason:reason);
  }
  String time(String raw)=>TimeOfDay.fromDateTime(DateTime.parse(raw).toLocal()).format(context);
  @override
  Widget build(BuildContext context){
    final t=ticket;
    return Scaffold(appBar:AppBar(title:Text(widget.recovery?'Payment recovery':widget.orderId==null?'Kitchen queue':'Order details'),actions:[
      IconButton(onPressed:busy?null:load,tooltip:'Refresh kitchen',icon:const Icon(Icons.refresh)),
    ]),body:ListView(padding:const EdgeInsets.all(20),children:[
      if(!loaded&&busy)const LinearProgressIndicator(),
      if(error!=null)Text(error!),
      if(widget.orderId==null)...[
        if(loaded&&rows.isEmpty)Text(widget.recovery?'No pending refunds.':'No paid orders waiting. The queue updates automatically.'),
        if(!widget.recovery && rows.any((r)=>r['state']=='NEW' && r['alerted']==true))const ListTile(leading:Icon(Icons.notifications_active),title:Text('New paid order in the kitchen')),
        for(final r in rows)Card(child:ListTile(
          leading:Icon(widget.recovery?Icons.receipt_long:Icons.restaurant_menu),
          title:Text('Order ${r['order_id'].substring(0,8)}'),
          subtitle:Text(widget.recovery?'${r['status']} · ${r['reason']}':'${kitchenLabels[r['state']]} · INR ${priceText(r['quote']['totalMinor'])}'),
          trailing:widget.recovery?null:const Icon(Icons.chevron_right),
          onTap:widget.recovery?null:()async{
            await Navigator.push(context,MaterialPageRoute(builder:(_)=>KitchenScreen(api:widget.api,path:widget.path,orderId:r['order_id'])));
            if(mounted)await load();
          },
        )),
      ]else if(t!=null)...[
        Text('Order ${t['order_id'].substring(0,8)}',style:Theme.of(context).textTheme.headlineMedium),
        Text(kitchenLabels[t['state']]??'',style:Theme.of(context).textTheme.titleLarge),
        if(t['state']=='NEW')Text('Accept by ${time(t['deadline'])}'),
        if(t['estimate_minutes']!=null)Text('Preparation estimate: ${t['estimate_minutes']} minutes'),
        for(final item in t['quote']['items'])ListTile(contentPadding:EdgeInsets.zero,title:Text('${item['quantity']} × ${item['name']}')),
        Text('Paid · INR ${priceText(t['quote']['totalMinor'])}'),const SizedBox(height:20),
        if(t['state']=='NEW')...[
          DropdownButtonFormField<int>(initialValue:minutes,decoration:const InputDecoration(labelText:'Preparation time'),
            items:[for(final m in [5,10,15,20,30,45,60,90])DropdownMenuItem(value:m,child:Text('$m minutes'))],onChanged:busy?null:(v)=>setState(()=>minutes=v!)),
          FilledButton(onPressed:busy?null:()=>act('accept'),child:const Text('Accept order')),
          TextButton(onPressed:busy?null:reject,child:const Text('Reject order')),
        ],
        if(t['state']=='ACCEPTED')FilledButton(onPressed:busy?null:()=>act('prepare'),child:const Text('Mark as preparing')),
        if(t['state']=='PREPARING')FilledButton(onPressed:busy?null:()=>act('ready'),child:const Text('Ready for pickup')),
        if(t['state']=='READY')const ListTile(leading:Icon(Icons.check_circle,color:Colors.green),title:Text('Kitchen work complete')),
        if(t['reason']!=null)Text('Refund review · ${t['reason']}'),
      ],
    ]));
  }
}




